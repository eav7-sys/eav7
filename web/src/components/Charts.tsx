export function BarSpark({ values, height = 74 }: { values: number[]; height?: number }) {
  const w = 520;
  const n = values.length || 1;
  const gap = 3;
  const bw = (w - gap * (n - 1)) / n;
  const max = Math.max(1, ...values);
  return (
    <svg className="mt-2.5 block w-full overflow-visible" style={{ height }} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="1" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity=".28" />
        </linearGradient>
      </defs>
      {values.map((v, i) => {
        const bh = Math.max(2, (v / max) * (height - 4));
        return <rect key={i} x={i * (bw + gap)} y={height - bh} width={Math.max(1, bw)} height={bh} rx="2" fill="url(#barGrad)" />;
      })}
    </svg>
  );
}

const COLORS = ['#9165f5', '#48dba6', '#66a6ff', '#f7cd63', '#ff86c8', '#b795ff'];

export function Donut({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = 52, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 130 130" className="h-[130px] w-[130px] flex-none -rotate-90">
        <circle cx="65" cy="65" r={R} fill="none" stroke="var(--surface)" strokeWidth="14" />
        {data.map((d, i) => {
          const len = (d.value / total) * C;
          const el = <circle key={i} cx="65" cy="65" r={R} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="14" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} strokeLinecap="butt" />;
          offset += len;
          return el;
        })}
      </svg>
      <div className="flex flex-1 flex-col gap-2 text-xs">
        {data.slice(0, 6).map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="mono truncate text-[11px] text-muted">{d.name}</span>
            <span className="ml-auto font-bold tnum">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
