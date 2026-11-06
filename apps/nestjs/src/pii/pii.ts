// Pseudonymisation and masking of free text (spec 03, `pii` module). Pure functions.

export interface KnownDriver {
  fullName: string;
  pseudonym: string;
}

export type Masker = (text: string) => string;

export const PHONE_MASK = '[phone masked]';
export const EMAIL_MASK = '[email masked]';
// First or last name shared by several drivers: no single pseudonym can be chosen
export const AMBIGUOUS_DRIVER = '[driver]';

const PHONE = /(?<![\w+])(?:\+33|0)\s?[1-9](?:[\s.-]?\d{2}){4}(?!\w)/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

const ACCENT_VARIANTS: Record<string, string> = {
  a: 'aàâäáãå',
  c: 'cç',
  e: 'eéèêë',
  i: 'iîïíì',
  o: 'oôöóòõ',
  u: 'uùûüú',
  y: 'yÿý',
  n: 'nñ',
};

const MIN_NAME_PART_LENGTH = 3;

export function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '');
}

// Accent-insensitive pattern: "Hélène" matches "helene", "HELENE", "Hélene"…
function accentInsensitivePattern(name: string): string {
  return stripAccents(name)
    .toLowerCase()
    .split('')
    .map((ch) => {
      if (/\s/.test(ch)) return '\\s+';
      const variants = ACCENT_VARIANTS[ch];
      return variants
        ? `[${variants}]`
        : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
}

function wordRegex(name: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${accentInsensitivePattern(name)}(?![\\p{L}\\p{N}])`,
    'giu',
  );
}

export function createMasker(drivers: KnownDriver[]): Masker {
  const replacements = new Map<string, string>();
  const partOwners = new Map<string, Set<string>>();

  for (const driver of drivers) {
    replacements.set(driver.fullName, driver.pseudonym);
    for (const part of driver.fullName.split(/[\s-]+/)) {
      if (part.length < MIN_NAME_PART_LENGTH) continue;
      const key = stripAccents(part).toLowerCase();
      const owners = partOwners.get(key) ?? new Set<string>();
      owners.add(driver.pseudonym);
      partOwners.set(key, owners);
    }
  }
  for (const [part, owners] of partOwners) {
    if (replacements.has(part)) continue;
    replacements.set(
      part,
      owners.size === 1 ? [...owners][0] : AMBIGUOUS_DRIVER,
    );
  }

  // Full names first (longer), then first and last names alone
  const rules = [...replacements.entries()]
    .sort(([a], [b]) => b.length - a.length)
    .map(([name, pseudonym]) => ({ regex: wordRegex(name), pseudonym }));

  return (text: string) => {
    let masked = text.replace(EMAIL, EMAIL_MASK).replace(PHONE, PHONE_MASK);
    for (const { regex, pseudonym } of rules) {
      masked = masked.replace(regex, pseudonym);
    }
    return masked;
  };
}

// Applies masking to every string of a JSON response
export function maskDeep<T>(value: T, mask: Masker): T {
  if (typeof value === 'string') return mask(value) as T;
  if (Array.isArray(value))
    return value.map((item) => maskDeep(item, mask)) as T;
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, maskDeep(item, mask)]),
    ) as T;
  }
  return value;
}
