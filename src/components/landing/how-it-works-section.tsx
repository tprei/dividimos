"use client";

import { motion } from "framer-motion";

function NfeIllustration() {
  return (
    <svg viewBox="0 0 200 260" fill="none" className="h-full w-full text-primary" aria-hidden>
      <rect x="30" y="10" width="140" height="240" rx="6" className="fill-primary/5 stroke-primary/30" strokeWidth="1.5" />
      <rect x="50" y="30" width="100" height="12" rx="2" className="fill-primary/20" />
      <rect x="50" y="52" width="70" height="6" rx="1" className="fill-primary/15" />
      <line x1="45" y1="72" x2="155" y2="72" className="stroke-primary/20" strokeWidth="1" strokeDasharray="3 2" />
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <rect x="50" y={82 + i * 24} width={60 + (i % 3) * 10} height="6" rx="1" className="fill-primary/15" />
          <rect x="130" y={82 + i * 24} width="24" height="6" rx="1" className="fill-primary/20" />
        </g>
      ))}
      <line x1="45" y1="205" x2="155" y2="205" className="stroke-primary/20" strokeWidth="1" strokeDasharray="3 2" />
      <rect x="100" y="215" width="54" height="8" rx="2" className="fill-primary/30" />
      <text x="127" y="222" textAnchor="middle" fontSize="6" fontWeight="bold" className="fill-primary/50">R$ 147,80</text>
      <rect x="65" y="232" width="70" height="18" rx="4" className="stroke-primary/30" strokeWidth="1.5" fill="none" />
      {[72, 82, 92, 102, 112, 122].map((x) => (
        <rect key={x} x={x} y="237" width="8" height="8" rx="1" className="fill-primary/20" />
      ))}
    </svg>
  );
}

function DebtGraphIllustration() {
  return (
    <svg viewBox="0 0 240 200" fill="none" className="h-full w-full" aria-hidden>
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <path d="M0,0 L8,3 L0,6" className="fill-chart-2/40" />
        </marker>
      </defs>
      {[
        { cx: 60, cy: 50, label: "A" },
        { cx: 180, cy: 50, label: "B" },
        { cx: 120, cy: 160, label: "C" },
      ].map((n) => (
        <g key={n.label}>
          <circle cx={n.cx} cy={n.cy} r="24" className="fill-chart-2/15 stroke-chart-2/40" strokeWidth="1.5" />
          <text x={n.cx} y={n.cy + 4} textAnchor="middle" fontSize="11" fontWeight="bold" className="fill-chart-2/60">{n.label}</text>
        </g>
      ))}
      <line x1="84" y1="50" x2="156" y2="50" className="stroke-chart-2/30" strokeWidth="2" markerEnd="url(#arrow)" />
      <text x="120" y="44" textAnchor="middle" fontSize="8" className="fill-chart-2/50">R$32</text>
      <line x1="68" y1="72" x2="112" y2="138" className="stroke-chart-2/30" strokeWidth="2" markerEnd="url(#arrow)" />
      <text x="82" y="110" textAnchor="middle" fontSize="8" className="fill-chart-2/50">R$18</text>
      <line x1="172" y1="72" x2="128" y2="138" className="stroke-chart-2/30" strokeWidth="2" markerEnd="url(#arrow)" />
      <text x="158" y="110" textAnchor="middle" fontSize="8" className="fill-chart-2/50">R$25</text>
    </svg>
  );
}

const QR_PATTERN = [
  [1,1,1,1,1,1,1,0,1,0,1,0,1,0,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,1,0,0,1,0,1,1,0,1,0,0,0,0,0,1],
  [1,0,1,1,1,0,1,0,1,0,1,0,0,0,1,0,1,1,1,0,1],
  [1,0,1,1,1,0,1,0,0,1,1,1,0,0,1,0,1,1,1,0,1],
  [1,0,1,1,1,0,1,0,1,0,0,1,1,0,1,0,1,1,1,0,1],
  [1,0,0,0,0,0,1,0,0,1,0,0,1,0,1,0,0,0,0,0,1],
  [1,1,1,1,1,1,1,0,1,0,1,0,1,0,1,1,1,1,1,1,1],
  [0,0,0,0,0,0,0,0,1,1,0,1,0,0,0,0,0,0,0,0,0],
  [1,0,1,0,1,1,1,1,0,0,1,0,1,1,1,0,1,1,0,1,0],
  [0,1,0,1,0,0,0,1,1,0,1,1,0,0,1,1,0,0,1,0,1],
  [1,0,1,1,0,1,1,0,0,1,0,0,1,0,1,0,1,0,1,1,0],
  [0,1,0,0,1,0,0,1,0,1,1,0,0,1,0,1,0,1,0,0,1],
  [1,1,0,1,0,1,1,0,1,0,0,1,1,0,1,1,0,1,1,0,1],
  [0,0,0,0,0,0,0,0,1,0,1,0,1,0,0,0,1,0,0,1,0],
  [1,1,1,1,1,1,1,0,0,1,0,1,0,1,1,0,1,1,1,0,1],
  [1,0,0,0,0,0,1,0,1,0,1,0,1,0,1,1,0,0,1,0,0],
  [1,0,1,1,1,0,1,0,0,0,1,1,0,1,0,0,1,0,1,1,1],
  [1,0,1,1,1,0,1,0,1,1,0,0,1,0,1,0,0,1,0,1,0],
  [1,0,1,1,1,0,1,0,1,0,1,1,0,1,1,1,0,1,0,0,1],
  [1,0,0,0,0,0,1,0,0,1,0,1,0,0,0,1,1,0,1,1,0],
  [1,1,1,1,1,1,1,0,1,0,0,1,1,1,1,0,1,0,1,0,1],
];

function QrPhoneIllustration() {
  const size = 3.2;
  const ox = 57;
  const oy = 50;
  return (
    <svg viewBox="0 0 180 240" fill="none" className="h-full w-full" aria-hidden>
      <rect x="35" y="10" width="110" height="200" rx="16" className="fill-chart-3/5 stroke-chart-3/30" strokeWidth="2" />
      <rect x="70" y="14" width="40" height="6" rx="3" className="fill-chart-3/15" />
      <rect x={ox - 4} y={oy - 4} width={21 * size + 8} height={21 * size + 8} rx="3" className="fill-white stroke-chart-3/20" strokeWidth="1" />
      {QR_PATTERN.flatMap((row, r) =>
        row.map((cell, c) =>
          cell ? (
            <rect key={`${r}-${c}`} x={ox + c * size} y={oy + r * size} width={size} height={size} className="fill-chart-3/70" />
          ) : null
        )
      )}
      <rect x="55" y="135" width="70" height="8" rx="2" className="fill-chart-3/20" />
      <text x="90" y="142" textAnchor="middle" fontSize="6" fontWeight="bold" className="fill-chart-3/40">R$ 49,27</text>
      <rect x="60" y="152" width="60" height="18" rx="6" className="fill-chart-3/15 stroke-chart-3/25" strokeWidth="1" />
      <text x="90" y="164" textAnchor="middle" fontSize="7" fontWeight="600" className="fill-chart-3/50">Copiar Pix</text>
    </svg>
  );
}

const steps = [
  {
    title: "Escaneie",
    desc: "Aponta pro QR code da nota ou tira uma foto. Os itens aparecem na hora.",
    illustration: NfeIllustration,
    accent: "text-primary",
    bg: "bg-primary/5",
    number: "01",
  },
  {
    title: "Atribua",
    desc: "Cada um toca no que comeu. O app calcula quem deve o quê.",
    illustration: DebtGraphIllustration,
    accent: "text-chart-2",
    bg: "bg-chart-2/5",
    number: "02",
  },
  {
    title: "Pague",
    desc: "QR code Pix gerado com o valor certinho. Copia, cola, tá pago.",
    illustration: QrPhoneIllustration,
    accent: "text-chart-3",
    bg: "bg-chart-3/5",
    number: "03",
  },
];

const clipPaths = [
  "polygon(0 0, 100% 0, calc(100% - 4rem) 100%, 0 100%)",
  "polygon(4rem 0, 100% 0, calc(100% - 4rem) 100%, 0 100%)",
  "polygon(4rem 0, 100% 0, 100% 100%, 0 100%)",
];

export function HowItWorksSection() {
  return (
    <div className="flex flex-col sm:grid sm:grid-cols-3">
      {steps.map((step, idx) => (
        <motion.div
          key={step.title}
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ delay: idx * 0.15, duration: 0.6 }}
          className={`hiw-panel relative overflow-hidden ${step.bg}`}
          data-index={idx}
        >
          <div className="flex flex-col items-center gap-6 px-8 py-12 text-center sm:py-16">
            <div className="h-44 w-44 sm:h-52 sm:w-52">
              <step.illustration />
            </div>
            <div>
              <span className={`text-xs font-bold tracking-widest ${step.accent} opacity-60`}>
                {step.number}
              </span>
              <h3 className="mt-2 text-xl font-bold sm:text-2xl">{step.title}</h3>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
                {step.desc}
              </p>
            </div>
          </div>
        </motion.div>
      ))}
      <style>{`
        @media (min-width: 640px) {
          .hiw-panel[data-index="0"] { clip-path: ${clipPaths[0]}; }
          .hiw-panel[data-index="1"] { clip-path: ${clipPaths[1]}; margin-left: -4rem; }
          .hiw-panel[data-index="2"] { clip-path: ${clipPaths[2]}; margin-left: -4rem; }
        }
      `}</style>
    </div>
  );
}
