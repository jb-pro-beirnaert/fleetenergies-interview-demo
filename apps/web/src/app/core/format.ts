// La journée de démo est en heure de Paris, quel que soit le fuseau du navigateur
const TZ = 'Europe/Paris';

const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
});
const numberFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const decimalFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

const toDate = (value: string | number | Date) => (value instanceof Date ? value : new Date(value));

export const fmtDateTime = (value: string | number | Date) =>
  dateTimeFmt.format(toDate(value)).replace(',', '');

export const fmtTime = (value: string | number | Date) => timeFmt.format(toDate(value));

export const fmtLiters = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `${numberFmt.format(value)} L`;

export const fmtNumber = (value: number | null | undefined, decimals = false) =>
  value === null || value === undefined ? '—' : (decimals ? decimalFmt : numberFmt).format(value);

export const fmtPercent = (ratio: number | null | undefined) =>
  ratio === null || ratio === undefined ? '—' : `${Math.round(ratio * 100)} %`;

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
