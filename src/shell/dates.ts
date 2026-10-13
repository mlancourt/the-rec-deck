// Central-time calendar dates as YYYY-MM-DD strings.
// NEVER `new Date("YYYY-MM-DD")` — it parses as UTC midnight and shifts the day.

const central = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function centralToday(now: Date = new Date()): string {
  return central.format(now);
}

/** Pure calendar arithmetic on a YYYY-MM-DD string. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

const centralClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: 'numeric',
  minute: '2-digit',
});

/** "2026-10-13 2:05 PM CT" from an ISO instant (not a date-only string). */
export function centralStamp(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  return `${centralToday(t)} ${centralClock.format(t)} CT`;
}
