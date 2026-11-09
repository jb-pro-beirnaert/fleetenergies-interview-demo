import { z } from 'zod';
import { AlertStatus, DataSource, InvoiceStatus, RefuelSource } from './enums.ts';

// V2 — invoice extraction (spec 02). Produced by the extractor, checked by the API;
// the simulator records the expected values in its ground truth.

export const InvoiceFuelType = z.enum(['diesel', 'b100', 'hvo', 'adblue', 'other']);
export type InvoiceFuelType = z.infer<typeof InvoiceFuelType>;

export const InvoiceExtraction = z
  .object({
    /** e.g. "AS24", "TotalEnergies", "Garage Roux". */
    supplier: z.string().min(1),
    invoiceNumber: z.string().nullable(),
    issuedAt: z.iso.date().nullable(),
    /** Date and time of the refuel, if present on the document. */
    refuelAt: z.iso.datetime({ offset: true }).nullable(),
    stationName: z.string().nullable(),
    stationCity: z.string().nullable(),
    /** Normalised `AB-123-CD` if recognised. */
    plate: z.string().nullable(),
    fuelType: InvoiceFuelType.nullable(),
    liters: z.number().positive().nullable(),
    unitPriceEur: z.number().positive().nullable(),
    /** Amount including VAT. */
    totalEur: z.number().positive().nullable(),
    currency: z.enum(['EUR', 'other']),
    /** Does the document contain instructions addressed to a system? */
    suspiciousContent: z.boolean(),
    suspiciousExcerpt: z.string().nullable(),
    /** Uncertain fields. */
    confidenceNotes: z.string().max(200).nullable(),
  })
  .meta({ id: 'InvoiceExtraction' });
export type InvoiceExtraction = z.infer<typeof InvoiceExtraction>;

// --- Reception (`POST /api/invoices`, multipart: `file` + these fields) ------------------------

export const InvoiceUploadFields = z
  .object({
    receivedAt: z.iso.datetime({ offset: true }),
    source: DataSource.default('live'),
  })
  .meta({ id: 'InvoiceUploadFields' });
export type InvoiceUploadFields = z.infer<typeof InvoiceUploadFields>;

export const InvoiceUploadResult = z
  .object({
    invoiceId: z.uuid(),
    status: InvoiceStatus,
    suspicious: z.boolean(),
    /** False when the same file had already been received (idempotent on its SHA-256). */
    created: z.boolean(),
  })
  .meta({ id: 'InvoiceUploadResult' });
export type InvoiceUploadResult = z.infer<typeof InvoiceUploadResult>;

// --- Agent routes ------------------------------------------------------------------------------

/** `GET /agent/invoices/:id/text`: text extracted by code, masked by the `pii` module. */
export const InvoiceText = z
  .object({
    invoiceId: z.uuid(),
    text: z.string(),
    receivedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'InvoiceText' });
export type InvoiceText = z.infer<typeof InvoiceText>;

/** Reconciliation computed by the API (stored in `invoices.match_details`). */
export const InvoiceReconciliation = z
  .object({
    truckId: z.uuid().nullable(),
    plate: z.string().nullable(),
    refuelAt: z.iso.datetime({ offset: true }).nullable(),
    billedL: z.number().nullable(),
    observedRiseL: z.number().nullable(),
    gapL: z.number().nullable(),
    /** max(20 L, 8% of the billed liters). */
    toleranceL: z.number().nullable(),
    stationMatched: z.boolean(),
    stationName: z.string().nullable(),
    refuelId: z.uuid().nullable(),
    /** Card transaction the invoice was attached to, or refuel created from the invoice. */
    refuelSource: RefuelSource.nullable(),
    /** Liters of the attached fuel card transaction (`null` without one). */
    cardLiters: z.number().nullable(),
    /** Why the reconciliation could not conclude (`needs_review`). */
    reason: z.string().nullable(),
  })
  .meta({ id: 'InvoiceReconciliation' });
export type InvoiceReconciliation = z.infer<typeof InvoiceReconciliation>;

/** `POST /agent/invoices/:id/extraction` response. */
export const InvoiceExtractionOutcome = z
  .object({
    invoiceId: z.uuid(),
    status: InvoiceStatus,
    suspicious: z.boolean(),
    reconciliation: InvoiceReconciliation.nullable(),
    alertId: z.uuid().nullable(),
    /** True if the extraction had already been recorded (idempotent: nothing changed). */
    alreadyExtracted: z.boolean(),
  })
  .meta({ id: 'InvoiceExtractionOutcome' });
export type InvoiceExtractionOutcome = z.infer<typeof InvoiceExtractionOutcome>;

// --- Screen routes -----------------------------------------------------------------------------

export const InvoiceListItem = z
  .object({
    id: z.uuid(),
    status: InvoiceStatus,
    originalFilename: z.string().nullable(),
    receivedAt: z.iso.datetime({ offset: true }),
    supplier: z.string().nullable(),
    plate: z.string().nullable(),
    refuelAt: z.iso.datetime({ offset: true }).nullable(),
    liters: z.number().nullable(),
    totalEur: z.number().nullable(),
    suspicious: z.boolean(),
    gapL: z.number().nullable(),
    alertId: z.uuid().nullable(),
  })
  .meta({ id: 'InvoiceListItem' });
export type InvoiceListItem = z.infer<typeof InvoiceListItem>;

export const InvoiceList = z.array(InvoiceListItem).meta({ id: 'InvoiceList' });
export type InvoiceList = z.infer<typeof InvoiceList>;

export const InvoiceDetail = z
  .object({
    id: z.uuid(),
    status: InvoiceStatus,
    originalFilename: z.string().nullable(),
    receivedAt: z.iso.datetime({ offset: true }),
    rawText: z.string().nullable(),
    extraction: InvoiceExtraction.nullable(),
    suspicious: z.boolean(),
    suspiciousExcerpt: z.string().nullable(),
    reconciliation: InvoiceReconciliation.nullable(),
    alert: z.object({ id: z.uuid(), status: AlertStatus }).nullable(),
  })
  .meta({ id: 'InvoiceDetail' });
export type InvoiceDetail = z.infer<typeof InvoiceDetail>;

export const InvoiceListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type InvoiceListQuery = z.infer<typeof InvoiceListQuery>;
