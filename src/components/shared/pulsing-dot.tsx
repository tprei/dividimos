interface PulsingDotProps {
  className?: string;
}

export function PulsingDot({ className = "bg-primary" }: PulsingDotProps) {
  return (
    <span className="relative flex h-2 w-2">
      <span
        className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${className}`}
      />
      <span
        className={`relative inline-flex h-2 w-2 rounded-full ${className}`}
      />
    </span>
  );
}
