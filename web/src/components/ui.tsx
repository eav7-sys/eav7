import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { short } from '../lib/format';

export function Card({ children, className = '', topline = false }: { children: ReactNode; className?: string; topline?: boolean }) {
  return <div className={`card ${topline ? 'card-topline' : ''} p-5 sm:p-[22px] mb-4 ${className}`}>{children}</div>;
}

export function CardTitle({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <h2 className="flex items-center justify-between text-[13.5px] font-bold tracking-tight mb-4">
      <span>{children}</span>
      {extra && <span className="text-xs font-normal text-muted">{extra}</span>}
    </h2>
  );
}

export function Tile({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string }) {
  return (
    <div className="relative overflow-hidden rounded-tile border border-line bg-bg1 p-4 shadow-[var(--shadow-sm)] transition-transform duration-200 hover:-translate-y-[3px] hover:border-line-strong group">
      <div className="pointer-events-none absolute -right-[22%] -top-[34%] h-24 w-24 rounded-full opacity-100 transition-opacity group-hover:opacity-150"
        style={{ background: `radial-gradient(circle, ${accent ?? 'rgba(145,101,245,.32)'}, transparent 70%)` }} />
      <div className="text-[10px] font-semibold uppercase tracking-[1px] text-muted">{label}</div>
      <div className="mt-1.5 text-[23px] font-extrabold tracking-[-.4px] tnum">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

const BADGE_COLORS: Record<string, string> = {
  TRANSFER: 'text-ok border-ok/40 bg-ok/[.09]', EAVM_TRANSFER: 'text-ok border-ok/40 bg-ok/[.09]', CONFIRMED: 'text-ok border-ok/40 bg-ok/[.09]',
  STAKE: 'text-blue border-blue/40 bg-blue/[.09]', UNSTAKE: 'text-blue border-blue/40 bg-blue/[.09]',
  AI_TASK: 'text-violet border-violet/45 bg-violet/[.11]', AI_RESULT: 'text-violet border-violet/45 bg-violet/[.11]', AI_REFUND: 'text-violet border-violet/45 bg-violet/[.11]', ORACLE_REGISTER: 'text-violet border-violet/45 bg-violet/[.11]',
  BRIDGE_OUT: 'text-gold border-gold/40 bg-gold/[.09]', BRIDGE_IN: 'text-gold border-gold/40 bg-gold/[.09]', BRIDGE_SETTLE: 'text-gold border-gold/40 bg-gold/[.09]',
  TOKEN_CREATE: 'text-pink border-pink/40 bg-pink/[.09]', TOKEN_TRANSFER: 'text-pink border-pink/40 bg-pink/[.09]', TOKEN_APPROVE: 'text-pink border-pink/40 bg-pink/[.09]', TOKEN_TRANSFER_FROM: 'text-pink border-pink/40 bg-pink/[.09]',
  PENDING: 'text-gold border-gold/40', REFUNDED: 'text-muted border-line',
  critical: 'text-danger border-danger/50 bg-danger/[.09]', warning: 'text-gold border-gold/45 bg-gold/[.09]', info: 'text-blue border-blue/45 bg-blue/[.09]',
};

export function Badge({ label, kind }: { label: ReactNode; kind?: string }) {
  const cls = BADGE_COLORS[kind ?? String(label)] ?? 'text-muted border-line';
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2.5 py-[2.5px] text-[10.5px] font-semibold ${cls}`}>{label}</span>;
}

export function StatusDot({ on }: { on?: boolean }) {
  return <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: on ? 'var(--ok)' : 'var(--gold)', boxShadow: '0 0 8px currentColor', animation: on ? 'pulse 2.4s ease-in-out infinite' : undefined, color: on ? 'var(--ok)' : 'var(--gold)' }} />;
}

export function Spinner({ label }: { label?: string }) {
  return <div className="flex items-center gap-2 py-6 text-sm text-muted"><span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />{label}</div>;
}

export function PageTitle({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-extrabold tracking-[-.5px] text-[var(--clean)]">{title}</h1>
      {sub && <div className="mt-1 mono break-all text-[13px] text-muted">{sub}</div>}
    </div>
  );
}

export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 text-[13px] sm:grid-cols-[210px_1fr]">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className={`py-3 font-medium text-muted ${i < rows.length - 1 ? 'border-b border-surface2' : ''}`}>{k}</dt>
          <dd className={`break-all py-3 ${i < rows.length - 1 ? 'sm:border-b sm:border-surface2' : ''}`}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export const Mono = ({ children, className = '' }: { children: ReactNode; className?: string }) => <span className={`mono text-[11.5px] ${className}`}>{children}</span>;

export function AddrLink({ addr, len = 12 }: { addr: string | null | undefined; len?: number }) {
  if (!addr) return <span className="text-muted">—</span>;
  return <Link to={`/address/${addr}`} className="mono text-[11.5px] text-link hover:opacity-80">{short(addr, len)}</Link>;
}
export const TxLink = ({ id }: { id: string }) => <Link to={`/tx/${id}`} className="mono text-[11.5px] text-link hover:opacity-80">{short(id, 10)}</Link>;
export const BlockLink = ({ height }: { height: number }) => <Link to={`/block/${height}`} className="text-link hover:opacity-80">#{height}</Link>;

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="-mx-1.5 overflow-x-auto"><table className="w-full border-collapse text-[12.5px]">{children}</table></div>;
}
export const EmptyRow = ({ cols, children }: { cols: number; children: ReactNode }) => (
  <tr><td colSpan={cols} className="px-2.5 py-6 text-center text-muted">{children}</td></tr>
);
export const Th = ({ children }: { children: ReactNode }) => <th className="border-b border-line px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-[.8px] text-muted">{children}</th>;
export const Td = ({ children, className = '' }: { children: ReactNode; className?: string }) => <td className={`border-b border-surface2 px-2.5 py-3 align-middle tnum ${className}`}>{children}</td>;
