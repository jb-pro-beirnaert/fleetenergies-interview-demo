// V2 invoice rules (spec 03, "V2 — Invoices"). Pure functions: code reads the PDF, detects
// injections, checks the extraction and reconciles it with the telemetry — never the LLM.
import type { InvoiceExtraction } from '@fleet/contracts';
import { MINUTE_MS, round1 } from '../common/serialize.js';
import {
  findStops,
  nearestPlace,
  type PlaceRef,
  type Reading,
} from '../investigation-data/calculations.js';

// --- Injection detection on the raw text --------------------------------------------------------

/** Instructions addressed to a system or an assistant (spec 03). */
export const INJECTION_PATTERNS: readonly RegExp[] = [
  /\bignore\b[^.]{0,80}\binstructions?\b/i,
  /\bsystem\s+instructions?\b/i,
  /\bsystem\s+prompt\b/i,
  /\byou\s+are\s+(?:now\s+)?(?:an?\s+|the\s+)?(?:ai\b|assistant\b|language\s+model\b|chatbot\b)/i,
  /(?:^|\n)\s*assistant\s*:/i,
];

const EXCERPT_MAX = 300;

/** First suspicious passage (the sentence containing the match), or `null`. */
export function detectInjection(text: string): string | null {
  // Spaces normalised, line breaks kept (the `assistant:` pattern needs them)
  const source = text.replace(/[^\S\n]+/g, ' ');
  for (const pattern of INJECTION_PATTERNS) {
    const match = pattern.exec(source);
    if (!match) continue;
    const from = match.index + (match[0].startsWith('\n') ? 1 : 0);
    // The sentence around the match (a PDF line break does not end a sentence)
    const start = source.lastIndexOf('.', from - 1) + 1;
    const dot = source.indexOf('.', match.index + match[0].length);
    const end = dot === -1 ? source.length : dot + 1;
    return source.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, EXCERPT_MAX);
  }
  return null;
}

// --- Extraction consistency (spec 02) -------------------------------------------------------------

export const LITERS_MIN = 1;
export const LITERS_MAX = 1_200;
export const AMOUNT_TOLERANCE = 0.02;

/** Problems found in an extraction; empty if it is consistent. */
export function extractionProblems(extraction: InvoiceExtraction): string[] {
  const problems: string[] = [];
  const { liters, unitPriceEur, totalEur } = extraction;
  if (liters !== null && (liters < LITERS_MIN || liters > LITERS_MAX)) {
    problems.push(`liters must be between ${LITERS_MIN} and ${LITERS_MAX} (got ${liters})`);
  }
  if (liters !== null && unitPriceEur !== null && totalEur !== null) {
    const computed = liters * unitPriceEur;
    if (Math.abs(computed - totalEur) > AMOUNT_TOLERANCE * totalEur) {
      problems.push(
        `liters × unitPriceEur = ${computed.toFixed(2)} does not match totalEur = ${totalEur} (±2%): ` +
          'check that unitPriceEur and totalEur both include VAT',
      );
    }
  }
  return problems;
}

/** `AB-123-CD` if the text is a French plate (with or without separators), otherwise `null`. */
export function normalizePlate(raw: string | null): string | null {
  if (!raw) return null;
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const match = /^([A-Z]{2})(\d{3})([A-Z]{2})$/.exec(compact);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

// --- Reconciliation with the telemetry ------------------------------------------------------------

export const RISE_BEFORE_MS = 30 * MINUTE_MS;
export const RISE_AFTER_MS = 60 * MINUTE_MS;
export const PRESENCE_MARGIN_MS = 30 * MINUTE_MS;
export const REFUEL_MATCH_MARGIN_MS = 30 * MINUTE_MS;
export const GAP_MIN_L = 20;
export const GAP_RATIO = 0.08;

/**
 * Observed tank rise around `t`: max(level over [t, t + 60 min]) − min(level over [t − 30 min, t]).
 * `null` if readings are missing on one side.
 */
export function observedRise(readings: Reading[], t: Date): number | null {
  const at = t.getTime();
  const before = readings.filter(
    (r) => r.at.getTime() >= at - RISE_BEFORE_MS && r.at.getTime() <= at,
  );
  const after = readings.filter(
    (r) => r.at.getTime() >= at && r.at.getTime() <= at + RISE_AFTER_MS,
  );
  if (before.length === 0 || after.length === 0) return null;
  const min = Math.min(...before.map((r) => r.fuelLevelL));
  const max = Math.max(...after.map((r) => r.fuelLevelL));
  return round1(Math.max(0, max - min));
}

/**
 * Fuel station where the truck stopped within [t − 30 min, t + 30 min], or `null`.
 * Every stopped reading of the window is checked, not only the first one of the stop: a short
 * hop (customer → nearby station in 2 min) can fall between two readings and merge both stops.
 */
export function stationVisited<P extends PlaceRef>(
  readings: Reading[],
  places: P[],
  t: Date,
): P | null {
  const at = t.getTime();
  const stations = places.filter((place) => place.type === 'fuel_station');
  for (const stop of findStops(readings)) {
    for (const reading of stop.readings) {
      if (Math.abs(reading.at.getTime() - at) > PRESENCE_MARGIN_MS) continue;
      const station = nearestPlace(reading, stations);
      if (station) return station;
    }
  }
  return null;
}

/** Tolerated gap between billed liters and observed rise: max(20 L, 8% of the billed liters). */
export const gapTolerance = (billedL: number) =>
  round1(Math.max(GAP_MIN_L, GAP_RATIO * billedL));
