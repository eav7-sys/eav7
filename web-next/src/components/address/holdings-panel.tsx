"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AddressInfo } from "@/lib/api";
import { fmt, fmtToken } from "@/lib/format";
import { useT } from "@/i18n/provider";
import { Logo } from "@/components/logo";

type Kind = "tokens" | "nfts" | "names" | "approvals";

// Uma linha da lista de participações: identidade à esquerda, quantidade à direita.
function Item({
  href,
  badge,
  icon,
  title,
  sub,
  value,
  hint,
}: {
  href?: string;
  badge?: string;
  icon?: React.ReactNode;
  title: string;
  sub?: string;
  value: string;
  hint?: string;
}) {
  const body = (
    <div className="flex items-center justify-between gap-3 border-b border-line/40 px-1 py-2.5 last:border-b-0">
      <span className="flex min-w-0 items-center gap-2">
        {icon && <span className="shrink-0">{icon}</span>}
        {!icon && badge && (
          <span className="font-mono shrink-0 rounded bg-violet/15 px-1.5 py-0.5 text-[10.5px] font-bold text-violet">
            {badge}
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-ink">{title}</span>
          {sub && <span className="font-mono block truncate text-[11px] text-faint">{sub}</span>}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="tnum block text-[13px] font-semibold text-ink">{value}</span>
        {hint && <span className="font-mono block text-[11px] text-faint">{hint}</span>}
      </span>
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:bg-line/30">
      {body}
    </Link>
  ) : (
    body
  );
}

export function HoldingsPanel({ info }: { info: AddressInfo }) {
  const t = useT();
  const [kind, setKind] = useState<Kind>("tokens");
  const [q, setQ] = useState("");

  const tokens = useMemo(() => Object.entries(info.tokens ?? {}), [info.tokens]);
  const nfts = info.nfts ?? [];
  const names = info.names ?? [];
  const approvals = info.approvals ?? [];

  const tabs: { key: Kind; label: string; count: number }[] = [
    // +1: o EAV7 nativo encabeça a lista, como a moeda nativa faz em qualquer explorer.
    { key: "tokens", label: t("page_address.tabTokens"), count: tokens.length + 1 },
    { key: "nfts", label: t("page_address.nftsTitle"), count: nfts.length },
    { key: "names", label: t("page_address.namesTitle"), count: names.length },
    { key: "approvals", label: t("page_address.tabApprovals"), count: approvals.length },
  ];

  // Filtro instantâneo sobre o que já veio do servidor — sem ida à rede.
  const needle = q.trim().toLowerCase();
  const match = (...fields: (string | undefined)[]) =>
    !needle || fields.some((f) => (f ?? "").toLowerCase().includes(needle));

  const rows = (() => {
    if (kind === "tokens") {
      // EAV7 nativo primeiro — é o ativo principal da conta, não um token EAV20.
      const native = match("EAV7") ? (
        <Item key="__native" icon={<Logo size={22} />} title="EAV7" value={fmt(info.balance)} hint="EAV7" />
      ) : null;
      const rest = tokens
        .filter(([id, tk]) => match(id, tk.symbol, tk.name))
        .map(([id, tk]) => (
          <Item
            key={id}
            href={`/address/${id}`}
            badge={tk.symbol}
            title={tk.name ?? tk.symbol ?? id}
            sub={id}
            value={fmtToken(tk.balance, tk.decimals ?? 0)}
            hint={tk.symbol}
          />
        ));
      return native ? [native, ...rest] : rest;
    }
    if (kind === "nfts") {
      return nfts
        .filter((n) => match(n.collection, n.symbol, n.tokenId))
        .map((n) => (
          <Item
            key={`${n.collection}-${n.tokenId}`}
            href={`/nfts/${n.collection}`}
            badge={n.symbol}
            title={`#${n.tokenId}`}
            sub={n.collection}
            value="1"
          />
        ));
    }
    if (kind === "names") {
      return names
        .filter((n) => match(n.name, n.target))
        .map((n) => (
          <Item key={n.name} href={`/address/${n.target}`} title={n.name} sub={n.target} value="—" />
        ));
    }
    return approvals
      .filter((a) => match(a.token, a.symbol, a.spender))
      .map((a, i) => (
        <Item
          key={`${a.token}-${a.spender}-${i}`}
          href={`/address/${a.spender}`}
          badge={a.symbol}
          title={a.spender}
          sub={t("page_address.colSpender")}
          value={fmt(a.amount)}
          hint={t("page_address.colLimit")}
        />
      ));
  })();

  return (
    <div className="card flex h-full flex-col p-0">
      {/* abas de participações — independentes das abas da página */}
      <div className="flex overflow-x-auto border-b border-line">
        {tabs.map((tb) => {
          const active = tb.key === kind;
          return (
            <button
              key={tb.key}
              type="button"
              onClick={() => setKind(tb.key)}
              aria-pressed={active}
              className={`whitespace-nowrap border-b-2 px-4 py-3 text-[12.5px] font-semibold transition-colors ${
                active ? "border-violet text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {tb.label} <span className="tnum text-faint">({tb.count})</span>
            </button>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-4">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("page_address.searchHoldings")}
          aria-label={t("page_address.searchHoldings")}
          className="w-full rounded-md border border-line bg-transparent px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-violet"
        />
        <div className="mt-2 min-h-[180px] flex-1 overflow-y-auto">
          {rows.length > 0 ? (
            rows
          ) : (
            <p className="py-8 text-center text-[12.5px] text-muted">{t("page_address.noHoldings")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
