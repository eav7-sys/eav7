// Glifo de "nó validador" — sem fundo, colorido de forma única por endereço.
// Segue o padrão do site: ícones sem caixa/fundo.
function hueOf(addr: string, salt: number): number {
  let h = salt;
  for (let i = 2; i < Math.min(addr.length, 16); i++) {
    h = (h * 31 + addr.charCodeAt(i)) % 360;
  }
  return h;
}

export function Identicon({ addr, size = 40 }: { addr: string; size?: number }) {
  const h1 = hueOf(addr, 7);
  const h2 = (h1 + 48 + (addr.charCodeAt(4) % 60)) % 360;
  const gid = `vg-${h1}-${h2}`;
  const rot = (addr.charCodeAt(6) % 6) * 60; // pequena variação por endereço

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="flex-none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor={`hsl(${h1} 78% 66%)`} />
          <stop offset="1" stopColor={`hsl(${h2} 72% 56%)`} />
        </linearGradient>
      </defs>
      <g transform={`rotate(${rot} 12 12)`}>
        {/* hexágono (nó) */}
        <path
          d="M12 2.6l8.1 4.7v9.4L12 21.4 3.9 16.7V7.3z"
          stroke={`url(#${gid})`}
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        {/* núcleo */}
        <circle cx="12" cy="12" r="2.4" fill={`url(#${gid})`} />
        {/* conexões */}
        <g stroke={`url(#${gid})`} strokeWidth="1.5" strokeLinecap="round" opacity="0.9">
          <path d="M12 9.6V4.6" />
          <path d="M14.1 13.2l4.3 2.5" />
          <path d="M9.9 13.2l-4.3 2.5" />
        </g>
      </g>
    </svg>
  );
}
