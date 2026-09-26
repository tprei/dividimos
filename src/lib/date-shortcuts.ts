/** Quick answers for "when was this?", the dates a bill usually happened on. */
export interface DateShortcut {
  label: string;
  iso: string;
}

const SHORT_MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"] as const;

export function toIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildDateShortcuts(today: string): DateShortcut[] {
  const base = new Date(`${today}T00:00:00`);
  return [
    { label: "Hoje", iso: today },
    { label: "Ontem", iso: shiftFrom(base, -1) },
    { label: "Anteontem", iso: shiftFrom(base, -2) },
    { label: "Há 1 semana", iso: shiftFrom(base, -7) },
  ];
}

/** "Hoje", "Ontem", "12 de set" this year, "12/09/2025" otherwise. */
export function friendlyDateLabel(iso: string, today: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  if (iso === today) return "Hoje";
  if (iso === shiftFrom(new Date(`${today}T00:00:00`), -1)) return "Ontem";
  const [, year, month, day] = match;
  if (year === today.slice(0, 4)) return `${Number(day)} de ${SHORT_MONTHS[Number(month) - 1]}`;
  return `${day}/${month}/${year}`;
}

function shiftFrom(base: Date, days: number): string {
  return toIsoDate(new Date(base.getFullYear(), base.getMonth(), base.getDate() + days));
}
