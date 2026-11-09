import { z } from 'zod';

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
