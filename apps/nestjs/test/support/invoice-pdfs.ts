// Invoice PDFs for the integration tests, rendered by the simulator's own renderer
// (same templates as the demo). Loaded at runtime: the simulator is not part of the API build.
import { DEMO_DAY } from './fixtures.js';

const RENDERER = new URL('../../../simulator/src/invoice-pdf.ts', import.meta.url).href;

type Template = 'as24' | 'totalenergies' | 'dkv' | 'independent';

export interface TestInvoice {
  template?: Template;
  invoiceNumber?: string;
  plate?: string;
  /** Refuel instant (UTC); printed in Paris local time. */
  refuelAt: Date;
  liters: number;
  unitPriceEur?: number;
  injection?: string | null;
  messy?: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Paris local date and time of an instant (the tests use October: UTC+2). */
function paris(at: Date) {
  const local = new Date(at.getTime() + 2 * 3_600_000);
  return {
    date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
  };
}

export async function invoicePdf(invoice: TestInvoice): Promise<Buffer> {
  const { renderInvoicePdf } = (await import(RENDERER)) as {
    renderInvoicePdf: (document: object) => Promise<Buffer>;
  };
  const unitPriceEur = invoice.unitPriceEur ?? 1.7;
  const totalEur = Math.round(invoice.liters * unitPriceEur * 100) / 100;
  const netEur = Math.round((totalEur / 1.2) * 100) / 100;
  const { date, time } = paris(invoice.refuelAt);
  return renderInvoicePdf({
    template: invoice.template ?? 'as24',
    supplier: 'AS24',
    issuer: { lines: ['AS24 – Fuel network for heavy goods vehicles'], vatId: 'FR00 000 000 024' },
    invoiceNumber: invoice.invoiceNumber ?? `F${invoice.refuelAt.getTime()}`,
    issuedAt: date,
    refuelDate: date,
    refuelTime: time,
    station: { name: 'AS24 Valence Sud', street: 'Rue de la Forêt', postcode: '26000', city: 'Valence' },
    carrier: 'Transports Durance',
    plate: invoice.plate ?? 'AB-123-CD',
    cardNumber: '7077 **** **** 1234',
    product: 'Diesel B7',
    fuelType: 'diesel',
    liters: invoice.liters,
    unitPriceEur,
    unitPriceExVatEur: Math.round((unitPriceEur / 1.2) * 10_000) / 10_000,
    netEur,
    vatEur: Math.round((totalEur - netEur) * 100) / 100,
    totalEur,
    messy: invoice.messy ?? false,
    injection: invoice.injection ?? null,
    styleKey: 'e2e',
  });
}

/** Valid PDF without any text (e.g. a scanned page without OCR). */
export const PDF_WITHOUT_TEXT = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);

/** Refuel instant used by the tests: 10:00 UTC on the demo day. */
export const REFUEL_AT = new Date(DEMO_DAY + 10 * 3_600_000);
