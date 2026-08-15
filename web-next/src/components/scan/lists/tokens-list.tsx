"use client";

import Link from "next/link";
import { type TokenSummary } from "@/lib/api";
import { addrLink, fmtToken, fmtUsd, num, numCompact, whenUtc } from "@/lib/format";
import { useT } from "@/i18n/provider";
import type { MarketPrice } from "@/lib/price-market";
import { Cartao, ListaShell, Selo, StatCard, Td, Th, Tr, Vazio, corDe } from "./table";

const COLUNAS = 6;

interface Props {
  tokens: TokenSummary[];
  eav7Price?: MarketPrice | null;
}

export function TokensList({ tokens, eav7Price }: Props) {
  const t = useT();
  const totalHolders = tokens.reduce((s, x) => s + (x.holders || 0), 0);
  const totalSupply = tokens.reduce((s, x) => s + (Number(x.totalSupply) || 0), 0);

  return (
    <ListaShell
      titulo={t("scanLists.titleTokens")}
      eyebrow={t("scanLists.eyebrowTokens")}
      subtitle={t("scanLists.subTokens")}
    >
      {eav7Price ? (
        <Link
          href="/sale"
          className="scan-glass mb-5 flex flex-wrap items-end justify-between gap-4 rounded-[18px] border border-[rgba(159,123,255,0.3)] px-[18px] py-4 transition hover:-translate-y-0.5 hover:border-[rgba(159,123,255,0.55)]"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="grid size-8 place-items-center rounded-full text-[10.5px] font-bold text-white"
              style={{ background: "linear-gradient(135deg,#7242D4,#4B2694)" }}
            >
              E7
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-bold text-ink">EAV7</div>
              <div className="text-[11px] text-faint">{eav7Price.sourceLabel}</div>
            </div>
            <span
              className={`ml-1 rounded-md px-2 py-0.5 text-[10.5px] font-bold ${
                eav7Price.change24hPct >= 0
                  ? "bg-[rgba(46,204,113,0.14)] text-ok"
                  : "bg-[rgba(231,76,60,0.14)] text-[var(--red)]"
              }`}
            >
              {eav7Price.change24hFormatted}
            </span>
          </div>
          <div className="text-right">
            <div className="font-display text-[24px] font-bold tracking-[-0.01em] text-ink">
              {eav7Price.priceUsdFormatted}
            </div>
            {eav7Price.marketCapUsd != null ? (
              <div className="text-[11px] text-faint">mcap {fmtUsd(eav7Price.marketCapUsd, 0)}</div>
            ) : (
              <div className="text-[11px] text-faint">/ EAV7</div>
            )}
          </div>
        </Link>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard label={t("scanLists.statsTokens")} value={num(tokens.length)} />
        <StatCard label={t("scanLists.statsHolders")} value={numCompact(totalHolders)} />
        <StatCard label={t("scanLists.statsSupply")} value={numCompact(totalSupply)} />
        <StatCard
          label="EAV7"
          value={eav7Price ? eav7Price.priceUsdFormatted : "—"}
        />
      </div>

      <Cartao>
        <table className="w-full min-w-[900px] border-collapse">
          <colgroup>
            <col style={{ width: 56 }} />
            <col />
            <col style={{ width: "22%" }} />
            <col style={{ width: 120 }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: 170 }} />
          </colgroup>
          <thead>
            <tr>
              <Th>{t("scanLists.colRank")}</Th>
              <Th>{t("scanLists.colToken")}</Th>
              <Th right>{t("scanLists.colSupply")}</Th>
              <Th right>{t("scanLists.colHolders")}</Th>
              <Th>{t("scanLists.colIssuer")}</Th>
              <Th right>{t("scanLists.colCreated")}</Th>
            </tr>
          </thead>
          <tbody>
            {tokens.length === 0 ? (
              <Vazio colunas={COLUNAS} msg={t("scanLists.emptyTokens")} />
            ) : (
              tokens.map((k, i) => (
                <LinhaToken key={k.id} k={k} posicao={i + 1} rotuloPausado={t("scanLists.paused")} />
              ))
            )}
          </tbody>
        </table>
      </Cartao>
    </ListaShell>
  );
}

function LinhaToken({
  k,
  posicao,
  rotuloPausado,
}: {
  k: TokenSummary;
  posicao: number;
  rotuloPausado: string;
}) {
  const iniciais = (k.symbol || k.name || "?").slice(0, 3).toUpperCase();
  const accent = corDe(k.id);

  return (
    <Tr>
      <Td className="font-mono text-faint">{posicao}</Td>
      <Td>
        <span className="flex items-center gap-3">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-[12px] text-[11px] font-bold text-white"
            style={{
              background: `linear-gradient(140deg, ${accent}, color-mix(in srgb, ${accent} 42%, #1a1826))`,
              boxShadow: `0 8px 18px -10px ${accent}`,
            }}
            aria-hidden
          >
            {iniciais}
          </span>
          <Link href={`/token/${k.id}`} className="min-w-0 group">
            <span className="block truncate font-display text-[14.5px] font-bold text-ink transition-colors group-hover:text-[var(--scan-link)]">
              {k.symbol}
            </span>
            <span className="block truncate text-[12px] text-muted">{k.name}</span>
          </Link>
          <span className="rounded-md border border-[var(--scan-border)] px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wide text-faint">
            EAV20
          </span>
          {k.paused ? <Selo tom="aviso">{rotuloPausado}</Selo> : null}
        </span>
      </Td>
      <Td right className="whitespace-nowrap font-medium tnum">
        {fmtToken(k.totalSupply, k.decimals)} {k.symbol}
      </Td>
      <Td right className="tnum text-muted">
        {num(k.holders)}
      </Td>
      <Td>
        <Link
          href={`/address/${k.creator}`}
          className="block truncate pr-3 font-mono text-[12.5px] text-[var(--scan-link)] hover:underline"
        >
          {addrLink(k.creator)}
        </Link>
      </Td>
      <Td right className="whitespace-nowrap text-muted">
        {k.createdAt ? whenUtc(k.createdAt) : "—"}
      </Td>
    </Tr>
  );
}
