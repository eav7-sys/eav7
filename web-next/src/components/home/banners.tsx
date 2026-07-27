// Banners animados únicos por seção — SVG vetorial, on-brand, leve.

function Frame({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <div
      className="relative grid aspect-[16/9] w-full place-items-center overflow-hidden border-b border-line-2"
      style={{
        background: `radial-gradient(120% 130% at 50% -10%, color-mix(in srgb, ${accent} 16%, var(--panel-2)), var(--panel-2))`,
      }}
    >
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)",
          backgroundSize: "34px 34px",
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-10 -top-8 h-3/4 blur-[54px]"
        style={{ background: `radial-gradient(circle, color-mix(in srgb, ${accent} 55%, transparent), transparent 70%)` }}
      />
      <div className="relative w-[40%] max-w-[168px]">{children}</div>
    </div>
  );
}

/* 1 · Lattice quântico (pós-quântica) */
export function QuantumLattice({ accent }: { accent: string }) {
  const coords = [30, 65, 100, 135, 170];
  return (
    <Frame accent={accent}>
      <svg viewBox="0 0 200 200" className="w-full b-float">
        <g stroke={accent} strokeOpacity="0.35" strokeWidth="0.8">
          {coords.map((x, i) => (
            <line key={"v" + i} x1={x} y1="30" x2={x} y2="170" />
          ))}
          {coords.map((y, i) => (
            <line key={"h" + i} x1="30" y1={y} x2="170" y2={y} />
          ))}
        </g>
        {coords.map((x, i) =>
          coords.map((y, j) => (
            <circle
              key={`d${i}${j}`}
              cx={x}
              cy={y}
              r="2.6"
              fill={accent}
              className="b-pulse"
              style={{ animationDelay: `${((i + j) % 5) * 0.35}s` }}
            />
          ))
        )}
        {/* escudo central */}
        <path
          d="M100 62 L128 74 V104 C128 124 116 134 100 142 C84 134 72 124 72 104 V74 Z"
          fill={`color-mix(in srgb, ${accent} 18%, transparent)`}
          stroke={accent}
          strokeWidth="2.2"
        />
        <circle cx="100" cy="98" r="7" fill="none" stroke={accent} strokeWidth="2.2" />
        <line x1="100" y1="104" x2="100" y2="118" stroke={accent} strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </Frame>
  );
}

/* 2 · Anel de blocos girando (DPoS) */
export function BlockRing({ accent }: { accent: string }) {
  const n = 10;
  const R = 66;
  return (
    <Frame accent={accent}>
      <svg viewBox="0 0 200 200" className="w-full">
        <circle cx="100" cy="100" r={R} fill="none" stroke={accent} strokeOpacity="0.2" strokeWidth="1" />
        <g className="b-spin">
          {Array.from({ length: n }).map((_, i) => {
            const a = (i / n) * Math.PI * 2 - Math.PI / 2;
            const x = 100 + R * Math.cos(a);
            const y = 100 + R * Math.sin(a);
            const lead = i === 0;
            return (
              <rect
                key={i}
                x={x - 8}
                y={y - 8}
                width="16"
                height="16"
                rx="3.5"
                fill={lead ? accent : `color-mix(in srgb, ${accent} 14%, transparent)`}
                stroke={accent}
                strokeWidth="1.6"
                strokeOpacity={lead ? 1 : 0.5}
              />
            );
          })}
        </g>
        {/* núcleo */}
        <circle cx="100" cy="100" r="20" fill={`color-mix(in srgb, ${accent} 14%, transparent)`} stroke={accent} strokeWidth="2" />
        <circle cx="100" cy="100" r="6" fill={accent} className="b-pulse" />
      </svg>
    </Frame>
  );
}

/* 3 · Rede neural / oráculo (IA) */
export function NeuralOracle({ accent }: { accent: string }) {
  const n = 6;
  const R = 68;
  const nodes = Array.from({ length: n }).map((_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: 100 + R * Math.cos(a), y: 100 + R * Math.sin(a) };
  });
  return (
    <Frame accent={accent}>
      <svg viewBox="0 0 200 200" className="w-full">
        {nodes.map((p, i) => (
          <line
            key={"l" + i}
            x1="100"
            y1="100"
            x2={p.x}
            y2={p.y}
            stroke={accent}
            strokeWidth="1.6"
            strokeOpacity="0.55"
            strokeDasharray="4 8"
            className="b-dash"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
        {nodes.map((p, i) => (
          <circle
            key={"n" + i}
            cx={p.x}
            cy={p.y}
            r="7"
            fill={`color-mix(in srgb, ${accent} 22%, var(--panel))`}
            stroke={accent}
            strokeWidth="1.8"
            className="b-pulse"
            style={{ animationDelay: `${i * 0.3}s` }}
          />
        ))}
        <circle cx="100" cy="100" r="16" fill={`color-mix(in srgb, ${accent} 18%, transparent)`} stroke={accent} strokeWidth="2.2" />
        <circle cx="100" cy="100" r="6" fill={accent} />
      </svg>
    </Frame>
  );
}

/* 4 · Ponte com tokens fluindo (EAV20 + ponte) */
export function BridgeFlow({ accent }: { accent: string }) {
  const arc = "M46 78 C 80 34, 120 34, 154 78";
  const chain = (x: number) =>
    [70, 100, 130].map((y, i) => (
      <rect
        key={x + "-" + i}
        x={x - 13}
        y={y - 9}
        width="26"
        height="18"
        rx="4"
        fill={`color-mix(in srgb, ${accent} 14%, transparent)`}
        stroke={accent}
        strokeWidth="1.6"
      />
    ));
  return (
    <Frame accent={accent}>
      <svg viewBox="0 0 200 200" className="w-full">
        {chain(46)}
        {chain(154)}
        <path id="bridgePath" d={arc} fill="none" stroke={accent} strokeOpacity="0.5" strokeWidth="2" strokeDasharray="5 7" />
        {[0, 0.8, 1.6].map((delay, i) => (
          <circle key={i} r="5" fill={accent}>
            <animateMotion dur="2.4s" begin={`${delay}s`} repeatCount="indefinite">
              <mpath href="#bridgePath" />
            </animateMotion>
          </circle>
        ))}
      </svg>
    </Frame>
  );
}
