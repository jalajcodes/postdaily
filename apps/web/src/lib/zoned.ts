// Small time-zone helpers for the queue calendar (dates are shown in your Settings time zone,
// which may differ from the device's).

export interface Parts {
  y: number;
  m: number; // 1-12
  d: number;
  h: number;
  min: number;
}

const fmt = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = fmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    fmt.set(tz, f);
  }
  return f;
}

/** The wall-clock date and time of an instant in `tz`. */
export function zonedParts(date: Date | string, tz: string): Parts {
  const p = Object.fromEntries(formatter(tz).formatToParts(new Date(date)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute };
}

/** "YYYY-MM-DD" of an instant in `tz`. */
export function dayKey(date: Date | string, tz: string) {
  const { y, m, d } = zonedParts(date, tz);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The instant (ISO, UTC) when the wall clock in `tz` reads the given date and time. */
export function zonedToIso(day: string, h: number, min: number, tz: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const want = Date.UTC(y, m - 1, d, h, min);
  let guess = want;
  // Two passes settle the offset, including across daylight-saving changes.
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), tz);
    guess += want - Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  }
  return new Date(guess).toISOString();
}

/** `day` plus `n` days, as "YYYY-MM-DD" (pure calendar math). */
export function addDays(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** ISO weekday of a "YYYY-MM-DD": 1 = Monday ... 7 = Sunday. */
export function isoWeekday(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/** The Monday of the week that contains `day`. */
export const weekStart = (day: string) => addDays(day, 1 - isoWeekday(day));

/** Same wall-clock time as `iso`, moved to `day`, in `tz`. */
export function moveToDay(iso: string, day: string, tz: string) {
  const { h, min } = zonedParts(iso, tz);
  return zonedToIso(day, h, min, tz);
}
