import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type {
  InvoiceDetail,
  InvoiceExtraction,
  InvoiceExtractionOutcome,
  InvoiceListItem,
  InvoiceReconciliation,
  InvoiceText,
  InvoiceUploadFields,
  InvoiceUploadResult,
} from '@fleet/contracts';
import { iso, MINUTE_MS, round1, toNum } from '../common/serialize.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type Invoice } from '../generated/prisma/client.js';
import type { Reading } from '../investigation-data/calculations.js';
import {
  detectInjection,
  extractionProblems,
  gapTolerance,
  normalizePlate,
  observedRise,
  PRESENCE_MARGIN_MS,
  REFUEL_MATCH_MARGIN_MS,
  RISE_AFTER_MS,
  RISE_BEFORE_MS,
  stationVisited,
} from './invoice-rules.js';
import { InvoiceStorage } from './invoice-storage.service.js';
import { extractPdfText } from './pdf-text.js';

type Tx = Prisma.TransactionClient;

export interface UploadedPdf {
  buffer: Buffer;
  originalname?: string;
}

/** Statuses after which the extraction is recorded: a new submission changes nothing. */
const EXTRACTED = new Set(['extracted', 'matched', 'mismatch', 'needs_review']);

const emptyReconciliation = (reason: string): InvoiceReconciliation => ({
  truckId: null,
  plate: null,
  refuelAt: null,
  billedL: null,
  observedRiseL: null,
  gapL: null,
  toleranceL: null,
  stationMatched: false,
  stationName: null,
  refuelId: null,
  refuelSource: null,
  reason,
});

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: InvoiceStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // --- Reception (device) ------------------------------------------------------------------------

  /**
   * Stores the PDF, extracts its text in code, detects injections, creates the
   * `extract_invoice` task. Idempotent on the file's SHA-256. A PDF without text → `failed`.
   */
  async upload(file: UploadedPdf, fields: InvoiceUploadFields): Promise<InvoiceUploadResult> {
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.prisma.invoice.findUnique({ where: { sha256 } });
    if (existing) return this.uploadResult(existing, false);

    const text = await extractPdfText(file.buffer);
    const excerpt = text ? detectInjection(text) : null;
    const id = randomUUID();
    const filePath = await this.storage.save(id, file.buffer);
    try {
      const invoice = await this.prisma.$transaction(async (tx) => {
        const created = await tx.invoice.create({
          data: {
            id,
            status: text ? 'received' : 'failed',
            sha256,
            filePath,
            originalFilename: file.originalname ?? null,
            rawText: text || null,
            suspicious: excerpt !== null,
            suspiciousExcerpt: excerpt,
            matchDetails: text
              ? Prisma.DbNull
              : (emptyReconciliation('No text in the PDF (scanned image or empty file)') as object),
            receivedAt: new Date(fields.receivedAt),
            dataOrigin: fields.source,
          },
        });
        if (text) {
          await tx.task.create({
            data: { type: 'extract_invoice', payload: { invoiceId: id } },
          });
        }
        return created;
      });
      return this.uploadResult(invoice, true);
    } catch (error) {
      await this.storage.remove(filePath);
      // Same file received concurrently: the other request created it
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.prisma.invoice.findUnique({ where: { sha256 } });
        if (winner) return this.uploadResult(winner, false);
      }
      throw error;
    }
  }

  private uploadResult(invoice: Invoice, created: boolean): InvoiceUploadResult {
    return {
      invoiceId: invoice.id,
      status: invoice.status,
      suspicious: invoice.suspicious,
      created,
    };
  }

  // --- Agent routes ------------------------------------------------------------------------------

  async text(id: string): Promise<InvoiceText> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (!invoice.rawText) throw new ConflictException('Invoice without text');
    // Masking of names, phone numbers and emails: `PiiInterceptor` on the controller
    return { invoiceId: invoice.id, text: invoice.rawText, receivedAt: iso(invoice.receivedAt) };
  }

  /**
   * Records the extraction (consistency rules, otherwise 422), merges `suspicious`
   * (code OR model), then reconciles. Idempotent once the extraction is recorded.
   */
  async submitExtraction(
    id: string,
    submitted: InvoiceExtraction,
  ): Promise<InvoiceExtractionOutcome> {
    const problems = extractionProblems(submitted);
    if (problems.length > 0) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: `Inconsistent extraction: ${problems.join('; ')}`,
        problems,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM invoices WHERE id = ${id}::uuid FOR UPDATE`;
      if (!locked) throw new NotFoundException('Invoice not found');
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id } });
      if (invoice.status === 'failed') {
        throw new ConflictException('Invoice without text: nothing to extract');
      }
      if (EXTRACTED.has(invoice.status)) return this.outcome(invoice, true);

      const extraction: InvoiceExtraction = {
        ...submitted,
        plate: normalizePlate(submitted.plate) ?? submitted.plate,
      };
      const suspicious = invoice.suspicious || extraction.suspiciousContent;
      const reconciliation = await this.reconcile(tx, invoice, extraction);
      const status = reconciliation.reason
        ? 'needs_review'
        : this.isMismatch(reconciliation)
          ? 'mismatch'
          : 'matched';
      const alertId =
        status === 'mismatch'
          ? await this.raiseBillingAlert(tx, invoice.id, extraction, reconciliation)
          : null;

      const updated = await tx.invoice.update({
        where: { id },
        data: {
          status,
          extraction: extraction as object,
          suspicious,
          suspiciousExcerpt:
            invoice.suspiciousExcerpt ?? (suspicious ? extraction.suspiciousExcerpt : null),
          matchDetails: reconciliation as object,
          matchedRefuelId: reconciliation.refuelId,
          alertId,
        },
      });
      return this.outcome(updated, false);
    });
  }

  private outcome(invoice: Invoice, alreadyExtracted: boolean): InvoiceExtractionOutcome {
    return {
      invoiceId: invoice.id,
      status: invoice.status,
      suspicious: invoice.suspicious,
      reconciliation: (invoice.matchDetails as InvoiceReconciliation | null) ?? null,
      alertId: invoice.alertId,
      alreadyExtracted,
    };
  }

  // --- Reconciliation (code, spec 03) --------------------------------------------------------------

  private isMismatch(r: InvoiceReconciliation): boolean {
    return !r.stationMatched || (r.gapL !== null && r.toleranceL !== null && r.gapL > r.toleranceL);
  }

  private async reconcile(
    tx: Tx,
    invoice: Invoice,
    extraction: InvoiceExtraction,
  ): Promise<InvoiceReconciliation> {
    const plate = normalizePlate(extraction.plate);
    if (!plate) return emptyReconciliation('Number plate missing or not recognised');
    const truck = await tx.truck.findUnique({ where: { plate } });
    if (!truck) return { ...emptyReconciliation(`Unknown truck: ${plate}`), plate };
    if (!extraction.refuelAt) {
      return { ...emptyReconciliation('Refuel date and time missing'), truckId: truck.id, plate };
    }
    if (extraction.liters === null) {
      return { ...emptyReconciliation('Billed liters missing'), truckId: truck.id, plate };
    }

    const t = new Date(extraction.refuelAt);
    const billedL = extraction.liters;
    const readings = await this.readings(tx, truck.id, {
      from: new Date(t.getTime() - Math.max(RISE_BEFORE_MS, PRESENCE_MARGIN_MS)),
      to: new Date(t.getTime() + Math.max(RISE_AFTER_MS, PRESENCE_MARGIN_MS)),
    });
    const base = { truckId: truck.id, plate, refuelAt: iso(t), billedL };
    const riseL = observedRise(readings, t);
    if (riseL === null) {
      return {
        ...emptyReconciliation('No telemetry around the refuel'),
        ...base,
      };
    }

    const places = await tx.place.findMany({
      select: { id: true, name: true, type: true, lat: true, lon: true, radiusM: true },
    });
    const station = stationVisited(readings, places, t);
    const refuel = await this.attachRefuel(tx, invoice, extraction, truck.id, t, station?.id ?? null);
    const gapL = round1(billedL - riseL);
    return {
      ...base,
      observedRiseL: riseL,
      gapL,
      toleranceL: gapTolerance(billedL),
      stationMatched: station !== null,
      stationName: station?.name ?? null,
      refuelId: refuel.id,
      refuelSource: refuel.source,
      reason: null,
    };
  }

  /**
   * The invoice is attached to the truck's card transaction within ±30 min (the nearest);
   * otherwise a refuel with `source = invoice` is created.
   */
  private async attachRefuel(
    tx: Tx,
    invoice: Invoice,
    extraction: InvoiceExtraction,
    truckId: string,
    t: Date,
    placeId: string | null,
  ) {
    const cards = await tx.refuel.findMany({
      where: {
        truckId,
        source: 'fuel_card',
        occurredAt: {
          gte: new Date(t.getTime() - REFUEL_MATCH_MARGIN_MS),
          lte: new Date(t.getTime() + REFUEL_MATCH_MARGIN_MS),
        },
      },
    });
    const card = cards.sort(
      (a, b) =>
        Math.abs(a.occurredAt.getTime() - t.getTime()) -
        Math.abs(b.occurredAt.getTime() - t.getTime()),
    )[0];
    if (card) {
      return tx.refuel.update({ where: { id: card.id }, data: { invoiceId: invoice.id } });
    }
    return tx.refuel.upsert({
      where: { truckId_occurredAt: { truckId, occurredAt: t } },
      update: { invoiceId: invoice.id },
      create: {
        truckId,
        occurredAt: t,
        placeId,
        liters: extraction.liters!,
        unitPriceEur: extraction.unitPriceEur,
        totalEur: extraction.totalEur,
        source: 'invoice',
        dataOrigin: invoice.dataOrigin,
        invoiceId: invoice.id,
      },
    });
  }

  /** `billing_mismatch` alert + investigation task (the investigator handles it like any alert). */
  private async raiseBillingAlert(
    tx: Tx,
    invoiceId: string,
    extraction: InvoiceExtraction,
    r: InvoiceReconciliation,
  ): Promise<string> {
    const at = new Date(r.refuelAt!);
    const alert = await tx.alert.create({
      data: {
        truckId: r.truckId!,
        type: 'billing_mismatch',
        status: 'detected',
        windowStart: at,
        windowEnd: new Date(at.getTime() + 15 * MINUTE_MS),
        // Liters billed but not seen in the tank
        dropL: r.gapL !== null && r.gapL > 0 ? r.gapL : null,
        details: {
          invoiceId,
          billedL: r.billedL,
          observedRiseL: r.observedRiseL,
          gapL: r.gapL,
          toleranceL: r.toleranceL,
          stationMatched: r.stationMatched,
          stationName: r.stationName,
          invoiceSupplier: extraction.supplier,
          invoiceStation: extraction.stationName,
          refuelAt: r.refuelAt,
        },
        detectedAt: new Date(),
      },
    });
    await tx.task.create({
      data: {
        type: 'investigate_alert',
        payload: { alertId: alert.id },
        availableAt: new Date(Date.now() + this.config.DETECTOR_DEBOUNCE_SECONDS * 1000),
      },
    });
    return alert.id;
  }

  private async readings(tx: Tx, truckId: string, window: { from: Date; to: Date }): Promise<Reading[]> {
    const rows = await tx.telemetryReading.findMany({
      where: { truckId, recordedAt: { gte: window.from, lte: window.to } },
      orderBy: { recordedAt: 'asc' },
    });
    return rows.map((row) => ({
      at: row.recordedAt,
      lat: row.lat,
      lon: row.lon,
      speedKmh: toNum(row.speedKmh),
      ignition: row.ignition,
      fuelLevelL: toNum(row.fuelLevelL),
      odometerKm: toNum(row.odometerKm),
    }));
  }

  // --- Screen routes -------------------------------------------------------------------------------

  async list(limit: number): Promise<InvoiceListItem[]> {
    const invoices = await this.prisma.invoice.findMany({
      orderBy: { receivedAt: 'desc' },
      take: limit,
    });
    return invoices.map((invoice) => {
      const extraction = invoice.extraction as InvoiceExtraction | null;
      const reconciliation = invoice.matchDetails as InvoiceReconciliation | null;
      return {
        id: invoice.id,
        status: invoice.status,
        originalFilename: invoice.originalFilename,
        receivedAt: iso(invoice.receivedAt),
        supplier: extraction?.supplier ?? null,
        plate: extraction?.plate ?? null,
        liters: extraction?.liters ?? null,
        totalEur: extraction?.totalEur ?? null,
        suspicious: invoice.suspicious,
        gapL: reconciliation?.gapL ?? null,
        alertId: invoice.alertId,
      };
    });
  }

  async detail(id: string): Promise<InvoiceDetail> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { alert: { select: { id: true, status: true } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return {
      id: invoice.id,
      status: invoice.status,
      originalFilename: invoice.originalFilename,
      receivedAt: iso(invoice.receivedAt),
      rawText: invoice.rawText,
      extraction: (invoice.extraction as InvoiceExtraction | null) ?? null,
      suspicious: invoice.suspicious,
      suspiciousExcerpt: invoice.suspiciousExcerpt,
      reconciliation: (invoice.matchDetails as InvoiceReconciliation | null) ?? null,
      alert: invoice.alert,
    };
  }

  async file(id: string): Promise<{ content: Buffer; filename: string }> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    try {
      return {
        content: await this.storage.read(invoice.filePath),
        filename: invoice.originalFilename ?? `${invoice.id}.pdf`,
      };
    } catch {
      throw new NotFoundException('Invoice file missing');
    }
  }
}
