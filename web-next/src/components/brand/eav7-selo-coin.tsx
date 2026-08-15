"use client";

/**
 * Selo oficial EAV7 — port fiel de `Selo EAV7.dc.html` (export EAVSCAN).
 */
import "./eav7-selo-coin.css";

export function Eav7SeloCoin({
  size = 280,
  className = "",
  float = true,
}: {
  size?: number;
  className?: string;
  float?: boolean;
}) {
  const h = Math.round((size * 646) / 560);
  const uid = "selo";
  return (
    <div
      className={`eav7-selo ${float ? "eav7-selo--float" : ""} ${className}`.trim()}
      style={{ width: size, height: h }}
    >
      <svg width={size} height={h} viewBox="0 0 560 646" aria-hidden className="block">
        <defs>
          <radialGradient id={`${uid}-halo`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#6336C4" stopOpacity="0.55" />
            <stop offset="60%" stopColor="#6336C4" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#6336C4" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${uid}-rim`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#F4EFFF" />
            <stop offset="22%" stopColor="#B79BFF" />
            <stop offset="50%" stopColor="#6336C4" />
            <stop offset="80%" stopColor="#2A1655" />
            <stop offset="100%" stopColor="#8F6BF2" />
          </linearGradient>
          <radialGradient id={`${uid}-face`} cx="36%" cy="30%" r="80%">
            <stop offset="0%" stopColor="#9D74FF" />
            <stop offset="45%" stopColor="#6A3BD1" />
            <stop offset="100%" stopColor="#341A6B" />
          </radialGradient>
          <linearGradient id={`${uid}-seven`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="45%" stopColor="#E9DFFF" />
            <stop offset="100%" stopColor="#B18CFF" />
          </linearGradient>
          <linearGradient id={`${uid}-shine`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
            <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${uid}-shadow`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#6336C4" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#6336C4" stopOpacity="0" />
          </radialGradient>
          <clipPath id={`${uid}-clip`}>
            <circle cx="280" cy="300" r="252" />
          </clipPath>
          <path id={`${uid}-arcTop`} d="M 100 300 A 180 180 0 0 1 460 300" />
          <path id={`${uid}-arcBottom`} d="M 82 300 A 198 198 0 0 0 478 300" />
        </defs>
        <circle className="eav7-selo__halo" cx="280" cy="300" r="286" fill={`url(#${uid}-halo)`} />
        <circle cx="280" cy="300" r="252" fill={`url(#${uid}-rim)`} />
        <circle
          cx="280"
          cy="300"
          r="245"
          fill="none"
          stroke="rgba(255,255,255,0.35)"
          strokeWidth="7"
          strokeDasharray="3 6.1"
        />
        <circle cx="280" cy="300" r="236" fill="none" stroke="rgba(16,6,44,0.55)" strokeWidth="3" />
        <circle cx="280" cy="300" r="224" fill={`url(#${uid}-face)`} />
        <circle cx="280" cy="300" r="224" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" />
        <circle
          cx="280"
          cy="300"
          r="206"
          fill="none"
          stroke="rgba(233,223,255,0.22)"
          strokeWidth="1"
          strokeDasharray="1.5 4"
        />
        <text
          fontFamily="var(--font-display), Space Grotesk, sans-serif"
          fontSize="21"
          fontWeight="600"
          letterSpacing="7"
          fill="#EDE5FF"
          opacity="0.92"
        >
          <textPath href={`#${uid}-arcTop`} startOffset="50%" textAnchor="middle">
            EAV7 · NETWORK
          </textPath>
        </text>
        <text
          fontFamily="var(--font-display), Space Grotesk, sans-serif"
          fontSize="19"
          fontWeight="600"
          letterSpacing="8"
          fill="#D9C9FF"
          opacity="0.8"
        >
          <textPath href={`#${uid}-arcBottom`} startOffset="50%" textAnchor="middle">
            MAINNET
          </textPath>
        </text>
        <text
          x="280"
          y="212"
          textAnchor="middle"
          fontFamily="var(--font-display), Space Grotesk, sans-serif"
          fontSize="27"
          fontWeight="600"
          letterSpacing="12"
          fill="#D9C9FF"
          opacity="0.9"
        >
          EAV
        </text>
        <text
          x="280"
          y="428"
          textAnchor="middle"
          fontFamily="var(--font-display), Space Grotesk, sans-serif"
          fontSize="248"
          fontWeight="700"
          fill="rgba(14,5,40,0.6)"
          transform="translate(0,9)"
        >
          7
        </text>
        <text
          x="280"
          y="428"
          textAnchor="middle"
          fontFamily="var(--font-display), Space Grotesk, sans-serif"
          fontSize="248"
          fontWeight="700"
          fill="rgba(255,255,255,0.5)"
          transform="translate(0,-4)"
        >
          7
        </text>
        <text
          x="280"
          y="428"
          textAnchor="middle"
          fontFamily="var(--font-display), Space Grotesk, sans-serif"
          fontSize="248"
          fontWeight="700"
          fill={`url(#${uid}-seven)`}
        >
          7
        </text>
        <g clipPath={`url(#${uid}-clip)`}>
          <g className="eav7-selo__shine">
            <rect
              x="205"
              y="-80"
              width="150"
              height="760"
              fill={`url(#${uid}-shine)`}
              transform="rotate(24 280 300)"
            />
          </g>
        </g>
        <g className="eav7-selo__twinkle">
          <path d="M 132 108 l 3 -9 3 9 9 3 -9 3 -3 9 -3 -9 -9 -3 z" fill="#E9DFFF" />
        </g>
        <g className="eav7-selo__twinkle" style={{ animationDelay: "1.1s" }}>
          <path d="M 452 132 l 2.4 -7.2 2.4 7.2 7.2 2.4 -7.2 2.4 -2.4 7.2 -2.4 -7.2 -7.2 -2.4 z" fill="#C9B2FF" />
        </g>
        <g className="eav7-selo__twinkle" style={{ animationDelay: "2s" }}>
          <path d="M 116 470 l 2 -6 2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 z" fill="#9F7BFF" />
        </g>
        <ellipse cx="280" cy="616" rx="196" ry="24" fill={`url(#${uid}-shadow)`} />
      </svg>
    </div>
  );
}
