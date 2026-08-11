// Ícones SVG próprios da carteira EAV7 — desenhados aqui, únicos.
type P = { size?: number; className?: string };
const base = (size: number, className?: string) =>
  ({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
  });

// criar: carteira com faísca (+ estrela)
export function IconCreateWallet({ size = 22, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H16a2 2 0 0 1 2 2v1.5" />
      <path d="M3 7.5V17a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" />
      <path d="M21 11.5h-4a2 2 0 0 0 0 4h4z" />
      <path d="M18.5 2.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" fill="currentColor" stroke="none" />
    </svg>
  );
}

// importar: chave entrando num slot
export function IconImportKey({ size = 22, className }: P) {
  return (
    <svg {...base(size, className)}>
      <circle cx="7" cy="9" r="3" />
      <path d="M9.1 11.1 14 16" />
      <path d="M12.5 14.5l1.5-1.5M14.5 16.5l1.5-1.5" />
      <path d="M17 20h3a1 1 0 0 0 1-1v-3" />
      <path d="M21 12v-1a1 1 0 0 0-1-1h-3" />
      <path d="M13.5 20.5 21 13" opacity="0" />
    </svg>
  );
}

// enviar: seta ascendente com rastro (foguete de valor)
export function IconSend({ size = 20, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M5 19 19 5" />
      <path d="M11 5h8v8" />
      <path d="M4 15l2 2" opacity=".5" />
    </svg>
  );
}

// receber: seta descendo numa bandeja
export function IconReceive({ size = 20, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 4v10" />
      <path d="M8 10l4 4 4-4" />
      <path d="M5 18h14" />
      <path d="M5 18v2M19 18v2" />
    </svg>
  );
}

// stake: moeda travada (cadeado sobre disco)
export function IconStakeLock({ size = 20, className }: P) {
  return (
    <svg {...base(size, className)}>
      <ellipse cx="12" cy="7" rx="7" ry="3" />
      <path d="M5 7v4c0 1.2 1.8 2.3 4.5 2.7" />
      <path d="M19 7v3" />
      <rect x="13" y="14" width="8" height="6" rx="1.5" />
      <path d="M15 14v-1.3a2 2 0 0 1 4 0V14" />
    </svg>
  );
}
