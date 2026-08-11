// Logos SVG próprios para cada token EAV20 do mock.
// Cada símbolo tem um desenho único; símbolos desconhecidos caem nas iniciais.

function UsdeMark({ size }: { size: number }) {
  // stablecoin — cifrão dentro de moeda
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9.2" opacity=".85" />
      <path d="M12 5.6v12.8" />
      <path d="M15 8.6c-.7-.9-1.8-1.4-3-1.4-1.7 0-3 .9-3 2.3 0 1.4 1.3 2 3 2.3s3 .9 3 2.3c0 1.4-1.3 2.3-3 2.3-1.2 0-2.3-.5-3-1.4" />
    </svg>
  );
}

function QbitMark({ size }: { size: number }) {
  // quantum — átomo com órbitas
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
      <ellipse cx="12" cy="12" rx="9" ry="3.8" />
      <ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(120 12 12)" />
    </svg>
  );
}

function AixMark({ size }: { size: number }) {
  // IA / oráculo — faísca com nós neurais
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.8l1.7 4.1 4.1 1.7-4.1 1.7L12 14.4l-1.7-4.1L6.2 8.6l4.1-1.7z" fill="currentColor" stroke="none" />
      <path d="M12 14.4v2.4M12 16.8l4.6 1.4M12 16.8l-4.6 1.4" />
      <circle cx="17" cy="18.4" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="7" cy="18.4" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

const MARKS: Record<string, (p: { size: number }) => React.ReactNode> = {
  USDE: UsdeMark,
  QBIT: QbitMark,
  AIX: AixMark,
};

export function TokenLogo({ symbol, size = 22 }: { symbol: string; size?: number }) {
  const Mark = MARKS[symbol.toUpperCase()];
  if (Mark) return <Mark size={size} />;
  // fallback: iniciais
  return <span className="font-display text-[15px] font-extrabold">{symbol.slice(0, 2)}</span>;
}
