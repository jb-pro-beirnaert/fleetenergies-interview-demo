// Simulated calendar, in Paris time: from day D − 1 month to day D (run date).
// The last day (D) is the demo day (`live`); the previous ones form the history.
// Internal time is a number of minutes since midnight (Paris time) of the first day.
// Daylight saving changes are handled: a day can last 23 h or 25 h.

export const TIME_ZONE = 'Europe/Paris';
/** One telematics reading every 5 minutes. */
export const STEP_MIN = 5;
export const STEP_MS = STEP_MIN * 60_000;

const wallClockFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function wallClock(utcMs: number) {
  const parts = Object.fromEntries(
    wallClockFormat.formatToParts(utcMs).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** Paris offset from UTC at a given instant, in minutes (+60 or +120). */
export function tzOffsetMin(utcMs: number): number {
  const wall = wallClock(utcMs);
  const [y, m, d] = wall.date.split('-').map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, wall.hour, wall.minute);
  return Math.round((wallAsUtc - Math.floor(utcMs / 60_000) * 60_000) / 60_000);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDate(date: string): string {
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error(`Invalid date "${date}" (expected YYYY-MM-DD)`);
  }
  return date;
}

const dateParts = (date: string) => assertDate(date).split('-').map(Number);

/** UTC instant (ms) of a Paris local time (`minutesOfDay` since midnight). */
export function localToUtcMs(date: string, minutesOfDay: number): number {
  const [y, m, d] = dateParts(date);
  const naive = Date.UTC(y, m - 1, d) + minutesOfDay * 60_000;
  const guess = naive - tzOffsetMin(naive) * 60_000;
  return naive - tzOffsetMin(guess) * 60_000;
}

export const localDateOf = (utcMs: number): string => wallClock(utcMs).date;

export function localHHMM(utcMs: number): string {
  const wall = wallClock(utcMs);
  return `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`;
}

/** Today's date in Paris. */
export const todayInParis = (now = Date.now()): string => localDateOf(now);

export function addDays(date: string, days: number): string {
  const [y, m, d] = dateParts(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Same day of the previous month (capped to the month's last day: 31/03 → 28/02). */
export function minusOneMonth(date: string): string {
  const [y, m, d] = dateParts(date);
  const lastDay = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 2, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

export function parseHHMM(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid time "${value}" (expected HH:MM)`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Invalid time "${value}"`);
  return hours * 60 + minutes;
}

export interface Calendar {
  /** First simulated day (D − 1 month). */
  startDate: string;
  /** Demo day (D). */
  demoDate: string;
  days: number;
  /** Index of the demo day (the last day). */
  liveDay: number;
  /** Start minute of the demo day. */
  liveStartMin: number;
  /** End of the period (midnight at the end of D). */
  endMin: number;
  /** Minute of midnight (Paris time) of a day; `dayStart(days)` = end of the period. */
  dayStart(day: number): number;
  dayOf(minute: number): number;
  /** Minute of a local time `HH:MM` on a given day. */
  at(day: number, hhmm: string): number;
  date(day: number): string;
  /** 0 = dimanche … 6 = samedi. */
  weekday(day: number): number;
  toIso(minute: number): string;
  fromIso(iso: string): number;
  hhmm(minute: number): string;
}

export function buildCalendar(today: string): Calendar {
  const demoDate = assertDate(today);
  const startDate = minusOneMonth(demoDate);
  const dates: string[] = [];
  for (let date = startDate; date <= demoDate; date = addDays(date, 1)) dates.push(date);
  const startUtcMs = localToUtcMs(startDate, 0);
  const toMin = (utcMs: number) => Math.round((utcMs - startUtcMs) / 60_000);
  const dayStarts = [...dates, addDays(demoDate, 1)].map((date) => toMin(localToUtcMs(date, 0)));
  const days = dates.length;

  const calendar: Calendar = {
    startDate,
    demoDate,
    days,
    liveDay: days - 1,
    liveStartMin: dayStarts[days - 1],
    endMin: dayStarts[days],
    dayStart: (day) => dayStarts[day],
    dayOf(minute) {
      let low = 0;
      let high = days - 1;
      while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (dayStarts[mid] <= minute) low = mid;
        else high = mid - 1;
      }
      return low;
    },
    at: (day, hhmm) => toMin(localToUtcMs(dates[day], parseHHMM(hhmm))),
    date: (day) => dates[day],
    weekday(day) {
      const [y, m, d] = dateParts(dates[day]);
      return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    },
    toIso: (minute) => new Date(startUtcMs + minute * 60_000).toISOString(),
    fromIso: (iso) => toMin(Date.parse(iso)),
    hhmm: (minute) => localHHMM(startUtcMs + minute * 60_000),
  };
  return calendar;
}
