"use client";

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Hoje";
  if (date.toDateString() === yesterday.toDateString()) return "Ontem";

  return date.toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
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

export function shouldShowDateSeparator(
  currentDate: string,
  previousDate: string | undefined,
): boolean {
  if (!previousDate) return true;
  return new Date(currentDate).toDateString() !== new Date(previousDate).toDateString();
}
