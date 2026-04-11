"use client";

function toUtcDateKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setUTCDate(today.getUTCDate() - 1);

  const dateKey = toUtcDateKey(dateStr);
  const todayKey = toUtcDateKey(today.toISOString());
  const yesterdayKey = toUtcDateKey(yesterday.toISOString());

  if (dateKey === todayKey) return "Hoje";
  if (dateKey === yesterdayKey) return "Ontem";

  return date.toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: date.getUTCFullYear() !== today.getUTCFullYear() ? "numeric" : undefined,
  });
}

interface ChatDateSeparatorProps {
  date: string;
}

export function ChatDateSeparator({ date }: ChatDateSeparatorProps) {
  return (
    <div className="flex items-center justify-center py-3">
      <span className="rounded-full bg-muted px-3 py-0.5 text-[11px] font-medium text-muted-foreground">
        {formatDateLabel(date)}
      </span>
    </div>
  );
}

export function shouldShowDateSeparator(currentDate: string, previousDate: string | undefined): boolean {
  if (!previousDate) return true;
  return toUtcDateKey(currentDate) !== toUtcDateKey(previousDate);
}
