/** Quick answers for "when was this?", the dates a bill usually happened on. */
export interface DateShortcut {
  label: string;
  iso: string;
}

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

function shiftFrom(base: Date, days: number): string {
  return toIsoDate(new Date(base.getFullYear(), base.getMonth(), base.getDate() + days));
}
