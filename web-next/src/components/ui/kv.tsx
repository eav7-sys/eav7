export interface KvRow {
  label: string;
  value: React.ReactNode;
}

export function Kv({ rows }: { rows: KvRow[] }) {
  return (
    <dl className="card p-0">
      {rows.map((r, i) => (
        <div
          key={r.label + i}
          className="grid grid-cols-1 gap-1 border-b border-line/60 px-5 py-3.5 last:border-b-0 sm:grid-cols-[190px_1fr] sm:gap-4"
        >
          <dt className="text-[12.5px] font-semibold text-muted">{r.label}</dt>
          <dd className="break-all text-[13px] text-ink">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
