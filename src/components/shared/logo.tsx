import { BRAND } from "@/lib/brand";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

const sizes = {
  sm: { icon: 20, text: "text-lg" },
  md: { icon: 28, text: "text-2xl" },
  lg: { icon: 40, text: "text-4xl" },
};

export function Logo({ size = "md", showText = true }: LogoProps) {
  const s = sizes[size];
  const words = BRAND.logoWords;
  const foregroundWords = words.slice(0, words.length - 1);
  const accentWord = words[words.length - 1];

  return (
    <div className="flex items-center gap-2.5">
      <div className="gradient-primary rounded-xl p-2 shadow-md shadow-primary/20">
        <svg
          width={s.icon}
          height={s.icon}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="2" />
          <circle cx="12" cy="12" r="6.5" stroke="white" strokeWidth="1.5" />
          <path
            d="M12 7v1.5M12 15.5V17M9.5 10.5c0-.83.67-1.5 1.5-1.5h2a1.5 1.5 0 0 1 0 3h-2a1.5 1.5 0 0 0 0 3h2c.83 0 1.5-.67 1.5-1.5"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
      {showText && (
        <span className={`${s.text} font-bold tracking-tight`}>
          {foregroundWords.map((word, i) => (
            <span key={i}>{word}{"."}</span>
          ))}
          <span className="text-primary">{accentWord}</span>
        </span>
      )}
    </div>
  );
}
