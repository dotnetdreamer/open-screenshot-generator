import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  withBackground?: boolean;
}

export function Logo({ className, withBackground = false }: LogoProps) {
  const frame = withBackground ? "stroke-white" : "stroke-primary";
  const frameFaded = withBackground ? "stroke-white/40" : "stroke-primary/40";
  const detail = withBackground ? "fill-white" : "fill-primary";

  return (
    <svg
      viewBox="0 0 512 512"
      role="img"
      aria-label="Artboard Studio logo"
      className={cn("shrink-0", className)}
    >
      {withBackground && (
        <>
          <defs>
            <linearGradient id="asLogoBg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#6FB3B5" />
              <stop offset="1" stopColor="#457E80" />
            </linearGradient>
          </defs>
          <rect width="512" height="512" rx="112" fill="url(#asLogoBg)" />
        </>
      )}
      {/* back phone */}
      <rect
        x="118"
        y="72"
        width="188"
        height="328"
        rx="44"
        fill="none"
        strokeWidth="26"
        className={frameFaded}
      />
      {/* front phone */}
      <rect
        x="206"
        y="112"
        width="188"
        height="328"
        rx="44"
        fill="none"
        strokeWidth="26"
        className={frame}
      />
      {/* speaker pill */}
      <rect x="272" y="142" width="56" height="12" rx="6" className={detail} />
      {/* screenshot glyph: sun + mountains */}
      <circle cx="262" cy="212" r="20" className="fill-accent" />
      <path
        d="M232 396 L282 318 L314 352 L352 300 L368 396 Z"
        className={cn(detail, "opacity-90")}
      />
      {/* selection handles */}
      <g className="fill-accent">
        <rect x="184" y="90" width="44" height="44" rx="10" />
        <rect x="372" y="90" width="44" height="44" rx="10" />
        <rect x="184" y="418" width="44" height="44" rx="10" />
        <rect x="372" y="418" width="44" height="44" rx="10" />
      </g>
    </svg>
  );
}
