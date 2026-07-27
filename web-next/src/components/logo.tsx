interface LogoProps {
  size?: number;
  className?: string;
}

// Emblema da lâmina do starburst EAV7 (centro da moeda), viewBox 40×40.
const BLADE = "M20 20 L23.1 12.5 L20 4.5 L16.9 12.5 Z";
const ANGLES = [0, 60, 120, 180, 240, 300];

// Marca EAV7 — starburst de 6 lâminas com gradiente violeta→teal, derivado da
// moeda. Fonte única: mantenha em sincronia com app/icon.svg e apple-icon.
export function Logo({ size = 34, className }: LogoProps) {
  const grad = "eav7-logo-grad";
  const glow = "eav7-logo-glow";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      aria-label="EAV7"
      role="img"
    >
      <defs>
        <linearGradient id={grad} x1="6" y1="4" x2="34" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#c9b6ff" />
          <stop offset="0.5" stopColor="#8a6bff" />
          <stop offset="1" stopColor="#45e0e6" />
        </linearGradient>
        <radialGradient id={glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#9a6cff" stopOpacity="0.32" />
          <stop offset="1" stopColor="#9a6cff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="20" cy="20" r="18" fill={`url(#${glow})`} />
      {ANGLES.map((a) => (
        <path key={a} d={BLADE} fill={`url(#${grad})`} transform={`rotate(${a} 20 20)`} />
      ))}
      <circle cx="20" cy="20" r="2.4" fill="#45e0e6" />
    </svg>
  );
}
