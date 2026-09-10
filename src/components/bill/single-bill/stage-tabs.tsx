"use client";

export type SingleBillStage = "conta" | "divisao";

const STAGE_TABS: { key: SingleBillStage; label: string }[] = [
  { key: "conta", label: "Conta" },
  { key: "divisao", label: "Divisão" },
];

export function SingleBillStageTabs({
  stage,
  divisaoEnabled,
  onSelect,
}: {
  stage: SingleBillStage;
  divisaoEnabled: boolean;
  onSelect: (stage: SingleBillStage) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-border px-4" role="tablist" aria-label="Etapas da conta">
      {STAGE_TABS.map((tab) => {
        const active = tab.key === stage;
        const disabled = tab.key === "divisao" && !divisaoEnabled;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onSelect(tab.key)}
            className={`-mb-px flex min-h-11 items-center justify-center whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors ${
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
