// Normalisation in code of what the model read (spec 06, extractor step 4): the model copies,
// the code converts. The model never computes a time zone offset.
import { z } from 'zod';
import { InvoiceExtraction } from '@fleet/contracts';

export const TIME_ZONE = 'Europe/Paris';

/** What the model returns: `InvoiceExtraction`, except the refuel time, local as printed. */
export const ModelExtraction = InvoiceExtraction.extend({
  // Simple pattern: the full date regex of `z.iso.date()` is heavy for the model's grammar
  issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').nullable(),
  /** Local date and time printed on the invoice (Paris), without time zone: `YYYY-MM-DDTHH:mm`. */
  refuelAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'expected YYYY-MM-DDTHH:mm (local time as printed)')
    .nullable(),
}).strict();
export type ModelExtraction = z.infer<typeof ModelExtraction>;

/** JSON schema imposed on the model (structured output). */
export const MODEL_JSON_SCHEMA = (() => {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(ModelExtraction, { io: 'input' }) as Record<string, unknown>;
  return schema;
})();

const offsetFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  timeZoneName: 'longOffset',
});

/** Offset of Paris at an instant, in minutes (+60 or +120). */
function parisOffsetMin(utcMs: number): number {
  const name = offsetFormat.formatToParts(utcMs).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

/** `YYYY-MM-DDTHH:mm` (Paris local time) → ISO UTC instant. */
export function parisLocalToIso(local: string): string {
  const naive = Date.parse(`${local}:00Z`);
  // Offset at the guessed instant, then corrected (daylight saving changes)
  const guess = naive - parisOffsetMin(naive) * 60_000;
  return new Date(naive - parisOffsetMin(guess) * 60_000).toISOString();
}

/** `AB-123-CD` if the text is a French plate (with or without separators), otherwise as read. */
export function normalizePlate(raw: string | null): string | null {
  if (!raw) return null;
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const match = /^([A-Z]{2})(\d{3})([A-Z]{2})$/.exec(compact);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : raw.trim();
}

const round = (value: number | null, decimals: number) =>
  value === null ? null : Math.round(value * 10 ** decimals) / 10 ** decimals;

export function normalize(model: ModelExtraction): InvoiceExtraction {
  return InvoiceExtraction.parse({
    ...model,
    refuelAt: model.refuelAt ? parisLocalToIso(model.refuelAt) : null,
    plate: normalizePlate(model.plate),
    liters: round(model.liters, 2),
    unitPriceEur: round(model.unitPriceEur, 3),
    totalEur: round(model.totalEur, 2),
    suspiciousExcerpt: model.suspiciousContent ? model.suspiciousExcerpt : null,
    confidenceNotes: model.confidenceNotes?.slice(0, 200) ?? null,
  });
}
