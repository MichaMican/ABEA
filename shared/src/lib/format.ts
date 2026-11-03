const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const longWeekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const fullDateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric" });

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function formatTime(ts: number): string {
  return timeFmt.format(new Date(ts));
}

/** Compact timestamp for chat lists: time today, weekday this week, date otherwise. */
export function formatListTime(ts: number): string {
  if (!ts) return "";
  const now = new Date();
  const d = new Date(ts);
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return timeFmt.format(d);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return weekdayFmt.format(d);
  if (d.getFullYear() === now.getFullYear()) return dateFmt.format(d);
  return d.toLocaleDateString();
}

export function formatDaySeparator(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return longWeekdayFmt.format(d);
  return fullDateFmt.format(d);
}

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b));
}

export function formatBytes(bytes?: number): string {
  if (!bytes && bytes !== 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function localpart(userId: string): string {
  return userId.replace(/^@/, "").split(":")[0];
}

export function serverName(userId: string): string {
  return userId.split(":").slice(1).join(":");
}
