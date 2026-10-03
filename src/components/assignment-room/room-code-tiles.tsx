import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface RoomCodeTilesProps {
  words: readonly [string, string];
  editing?: boolean;
  activeWord?: 0 | 1;
  loading?: boolean;
}

/** Visual feedback only; the host group or the real entry input owns the accessible code. */
export function RoomCodeTiles({ words, editing = false, activeWord = 0, loading = false }: RoomCodeTilesProps) {
  const letters = words.map((word) => Array.from(word.normalize("NFC").toLocaleUpperCase("pt-BR")));
  const slots = Math.min(10, Math.max(3, ...letters.map((word, row) =>
    Math.max(editing || loading ? 6 : 0, word.length + (editing && row === activeWord ? 1 : 0)),
  )));
  const style = { "--tile-size": `min(3rem, calc((100cqw - ${(slots - 1) * 4}px) / ${slots}))` } as CSSProperties;

  return (
    <div aria-hidden="true" className="@container w-full min-w-0" style={style}>
      <div className="flex flex-col items-center gap-1.5">
        {letters.map((word, row) => {
          const count = editing || loading ? Math.max(slots, word.length + (row === activeWord && editing ? 1 : 0)) : word.length;
          return (
            <div key={row} className="grid max-w-full justify-center gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(slots, count)}, var(--tile-size))` }}>
              {Array.from({ length: count }, (_, index) => {
                const letter = word[index];
                const active = editing && row === activeWord && index === word.length;
                return (
                  <span
                    key={index}
                    data-code-tile=""
                    data-active={active || undefined}
                    className={cn(
                      "flex aspect-square min-w-0 items-center justify-center rounded-xs border-2 text-[min(1.5rem,calc(var(--tile-size)*0.55))] leading-none font-bold",
                      letter ? "border-foreground/20 bg-card text-card-foreground" : "border-input bg-muted/40",
                      active && "border-foreground bg-card after:h-1/2 after:w-0.5 after:rounded-full after:bg-foreground",
                      loading && "bg-muted",
                    )}
                  >
                    {letter}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
