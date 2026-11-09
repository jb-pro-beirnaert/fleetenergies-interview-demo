import { currentLang, currentLocale } from './i18n/i18n';

// The demo week is in Paris time, whatever the browser's time zone
const TZ = 'Europe/Paris';

interface Formatters {
  dateTime: Intl.DateTimeFormat;
  time: Intl.DateTimeFormat;
  number: Intl.NumberFormat;
  decimal: Intl.NumberFormat;
  currency: Intl.NumberFormat;
}

const cache = new Map<string, Formatters>();

// Reads the language signal: a template calling a formatter re-renders when the language changes
function formatters(): Formatters {
  const locale = currentLocale();
  let f = cache.get(locale);
  if (!f) {
    f = {
      dateTime: new Intl.DateTimeFormat(locale, {
        timeZone: TZ,
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
      time: new Intl.DateTimeFormat(locale, { timeZone: TZ, hour: '2-digit', minute: '2-digit' }),
      number: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
      decimal: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
      currency: new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }),
    };
    cache.set(locale, f);
  }
  return f;
}

const toDate = (value: string | number | Date) => (value instanceof Date ? value : new Date(value));

export const fmtDateTime = (value: string | number | Date) =>
  formatters().dateTime.format(toDate(value)).replace(',', '');

export const fmtTime = (value: string | number | Date) => formatters().time.format(toDate(value));

/** Day and month of a calendar date (`YYYY-MM-DD`), without time-zone shift. */
export const fmtDayMonth = (isoDate: string) =>
  new Intl.DateTimeFormat(currentLocale(), { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
    .format(new Date(`${isoDate}T00:00:00Z`));

export const fmtLiters = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `${formatters().number.format(value)} L`;

export const fmtNumber = (value: number | null | undefined, decimals = false) =>
  value === null || value === undefined
    ? '—'
    : (decimals ? formatters().decimal : formatters().number).format(value);

export const fmtEuros = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : formatters().currency.format(value);

/** Fuel price per liter: 3 decimals, as printed on the pumps and invoices. */
export const fmtUnitPrice = (value: number | null | undefined) =>
  value === null || value === undefined
    ? '—'
    : `${new Intl.NumberFormat(currentLocale(), { style: 'currency', currency: 'EUR', minimumFractionDigits: 3 }).format(value)} / L`;

export const fmtPercent = (ratio: number | null | undefined) => {
  if (ratio === null || ratio === undefined) return '—';
  const n = Math.round(ratio * 100);
  // French typography puts a space before %
  return currentLang() === 'fr' ? `${n} %` : `${n}%`;
};

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

export function fmtMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}
