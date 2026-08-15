"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  getStatus,
  getValidators,
  type Status,
  type Validator,
  type ValidatorHealth,
  type ValidatorPerf,
  type Validators,
} from "@/lib/api";
import { addrLink, addrTight, ancoraIndex, fmt, fmtCompact, fmtNsName, num } from "@/lib/format";
import { useT, type TFunc } from "@/i18n/provider";
import { Cartao, ListaShell, Selo, StatCard, Td, Th, Tr, Vazio, corDe } from "./table";

interface Props {
  inicial: Validators | null;
  status: Status | null;
}

const pesoDe = (v: Validator) => BigInt(v.staked) + BigInt(v.votes ?? "0");

const TOM_SAUDE: Record<ValidatorHealth, "ok" | "aviso" | "erro"> = {
  healthy: "ok",
  lagging: "aviso",
  degraded: "erro",
  offline: "erro",
};

const CHAVE_SAUDE: Record<ValidatorHealth, string> = {
  healthy: "scanLists.vHealthHealthy",
  lagging: "scanLists.vHealthLagging",
  degraded: "scanLists.vHealthDegraded",
  offline: "scanLists.vHealthOffline",
};

type Aba = "active" | "bank";

export function ValidatorsList({ inicial, status }: Props) {
  const t = useT();
  // Aba na URL (?tab=bank), como nas telas de detalhe (ScanTabs): o endereço
  // fica compartilhável e o botão "voltar" do navegador desfaz a troca.
  // Sem parâmetro (ou valor desconhecido) cai em "active" — compatível com o
  // comportamento anterior, em que a aba inicial era sempre a de ativos.
  const params = useSearchParams();
  const aba: Aba = params.get("tab") === "bank" ? "bank" : "active";

  const vQ = useQuery({
    queryKey: ["scan-validators"],
    queryFn: getValidators,
    refetchInterval: 3000,
    initialData: inicial ?? undefined,
  });
  const sQ = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    refetchInterval: 2000,
    initialData: status ?? undefined,
  });

  const v = vQ.data;
  const st = sQ.data;

  if (!v) {
    return (
      <ListaShell
        titulo={t("scanLists.titleValidators")}
        eyebrow={t("scanLists.eyebrowValidators")}
        live
      >
        <div className="scan-glass p-10 text-center text-[13px] text-muted">
          {t("scanLists.unavailable")}
        </div>
      </ListaShell>
    );
  }

  // Âncoras fundação: ordem 1…N (não por endereço/peso — stake igual embaralhava 6,1,2…).
  const porAncoraDepoisPeso = (a: Validator, b: Validator) => {
    const ia = ancoraIndex(a.name);
    const ib = ancoraIndex(b.name);
    if (ia != null && ib != null && ia !== ib) return ia - ib;
    if (ia != null && ib == null) return -1;
    if (ia == null && ib != null) return 1;
    const pa = pesoDe(a);
    const pb = pesoDe(b);
    return pb > pa ? 1 : pb < pa ? -1 : a.address.localeCompare(b.address);
  };
  const ativos = [...v.current].sort(porAncoraDepoisPeso);
  const banco = [...(v.bank ?? [])].sort(porAncoraDepoisPeso);
  const lista = aba === "active" ? ativos : banco;
  const pesoTotal = ativos.reduce((acc, x) => acc + pesoDe(x), 0n);
  const produtor = st?.producer ?? v.slotProducer;
  const perfPor = new Map<string, ValidatorPerf>((v.performance ?? []).map((p) => [p.address, p]));
  const nomePor = new Map<string, string>(
    [...ativos, ...banco].flatMap((x) => (x.name ? [[x.address, x.name] as [string, string]] : [])),
  );
  const temPerf = aba === "active" && perfPor.size > 0;
  const colunas = temPerf ? 8 : 6;
  const bankCap = v.bankSize ?? 50;
  const summary = v.performanceSummary;

  const circulante = st ? BigInt(st.circulating || "0") : 0n;
  const taxaStake =
    circulante > 0n ? `${num(Number((pesoTotal * 10000n) / circulante) / 100)}%` : "—";

  const nomeProdutor = produtor ? nomePor.get(produtor) : undefined;

  return (
    <ListaShell
      titulo={t("scanLists.titleValidators")}
      eyebrow={t("scanLists.eyebrowValidators")}
      subtitle={t("scanLists.subValidators", {
        active: ativos.length,
        max: v.maxValidators,
        min: num(Number(BigInt(v.minStake) / 1_000_000n)),
      })}
      live
    >
      <div className="mb-5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard
          label={t("scanLists.cardValidators")}
          value={
            <>
              {num(ativos.length)}
              <span className="text-base font-semibold text-faint"> / {num(v.maxValidators)}</span>
            </>
          }
        />
        <StatCard
          label={t("scanLists.cardBank")}
          value={
            <>
              {num(banco.length)}
              <span className="text-base font-semibold text-faint"> / {num(bankCap)}</span>
            </>
          }
        />
        <StatCard
          label={t("scanLists.cardProducing")}
          value={
            <span className="flex items-center gap-2">
              <span className="scan-live" aria-hidden />
              {produtor ? (
                <Link href={`/address/${produtor}`} className="truncate text-[15px] text-[var(--scan-link)] hover:underline">
                  {fmtNsName(nomeProdutor) || addrTight(produtor)}
                </Link>
              ) : (
                "—"
              )}
            </span>
          }
        />
        <StatCard label={t("scanLists.cardStakeRate")} value={taxaStake} />
      </div>

      {summary && summary.avgScore != null ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[14px] border border-[var(--scan-border)] bg-[var(--scan-chip)] px-4 py-3 text-[12.5px] text-muted">
          <span className="font-semibold text-ink">
            {t("scanLists.healthAvg", { avg: summary.avgScore })}
          </span>
          <span className="text-faint">·</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-[var(--ok)]" aria-hidden />
            {t("scanLists.healthHealthyN", { n: summary.healthy })}
          </span>
          {summary.degraded > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-[color:var(--red)]">
              <span className="size-1.5 rounded-full bg-[var(--red)]" aria-hidden />
              {t("scanLists.healthDegradedN", { n: summary.degraded })}
            </span>
          ) : null}
          <span className="ml-auto font-mono text-[11px] text-faint">
            {fmt(v.blockReward)} EAV7 · {t("scanLists.cardBlockReward").toLowerCase()}
          </span>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2" role="tablist" aria-label={t("scanLists.titleValidators")}>
        <TabBtn active={aba === "active"} href="/validators">
          {t("scanLists.tabActive")} ({num(ativos.length)})
        </TabBtn>
        <TabBtn active={aba === "bank"} href="/validators?tab=bank">
          {t("scanLists.tabBank")} ({num(banco.length)})
        </TabBtn>
      </div>

      <Cartao>
        <table className="w-full min-w-[960px] border-collapse">
          <colgroup>
            <col style={{ width: 56 }} />
            <col />
            <col style={{ width: 140 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 100 }} />
            {temPerf ? <col style={{ width: 110 }} /> : null}
            {temPerf ? <col style={{ width: 110 }} /> : null}
          </colgroup>
          <thead>
            <tr>
              <Th>{t("scanLists.colRank")}</Th>
              <Th>{t("scanLists.colValidator")}</Th>
              <Th>{t("scanLists.colStatus")}</Th>
              <Th right>{t("scanLists.colStake")}</Th>
              <Th right>{t("scanLists.colVotes")}</Th>
              <Th right>{t("scanLists.colWeightPct")}</Th>
              {temPerf ? <Th right>{t("scanLists.colBlocksProd")}</Th> : null}
              {temPerf ? <Th right>{t("scanLists.colEfficiency")}</Th> : null}
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 ? (
              <Vazio
                colunas={colunas}
                msg={aba === "bank" ? t("scanLists.emptyBank") : t("scanLists.emptyValidators")}
              />
            ) : (
              lista.map((x, i) => (
                <LinhaValidador
                  key={x.address}
                  x={x}
                  posicao={aba === "active" ? i + 1 : v.maxValidators + i + 1}
                  produzindo={aba === "active" && x.address === produtor}
                  standby={aba === "bank"}
                  perf={perfPor.get(x.address) ?? null}
                  temPerf={temPerf}
                  pesoTotal={pesoTotal}
                  nome={x.name ?? undefined}
                  t={t}
                />
              ))
            )}
          </tbody>
        </table>
      </Cartao>
    </ListaShell>
  );
}

/** Aba-pílula. É um Link (não <button>): o estado mora na URL — ver ScanTabs. */
function TabBtn({
  active,
  href,
  children,
}: {
  active: boolean;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      role="tab"
      aria-selected={active}
      className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition ${
        active
          ? "border-[rgba(159,123,255,0.45)] bg-[var(--scan-chip)] text-[var(--scan-link)]"
          : "border-[var(--scan-border)] text-muted hover:bg-[var(--scan-hover)] hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

function LinhaValidador({
  x,
  posicao,
  produzindo,
  standby,
  perf,
  temPerf,
  pesoTotal,
  nome,
  t,
}: {
  x: Validator;
  posicao: number;
  produzindo: boolean;
  standby: boolean;
  perf: ValidatorPerf | null;
  temPerf: boolean;
  pesoTotal: bigint;
  nome?: string;
  t: TFunc;
}) {
  const peso = pesoDe(x);
  const pct = pesoTotal > 0n ? Number((peso * 10000n) / pesoTotal) / 100 : 0;
  const label = fmtNsName(nome);
  const accent = corDe(x.address);

  return (
    <Tr>
      <Td className="font-mono font-semibold text-faint">{posicao}</Td>
      <Td>
        <span className="flex min-w-0 items-center gap-3">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-[11px] text-[10px] font-bold text-white"
            style={{
              background: `linear-gradient(140deg, ${accent}, color-mix(in srgb, ${accent} 40%, #1a1826))`,
            }}
            aria-hidden
          >
            {(label || x.address).slice(0, 2).toUpperCase()}
          </span>
          <Link href={`/address/${x.address}`} className="min-w-0 group">
            <span className="block truncate font-display text-[14px] font-bold text-ink transition-colors group-hover:text-[var(--scan-link)]">
              {label || addrLink(x.address)}
            </span>
            {label ? (
              <span className="block truncate font-mono text-[11px] text-faint">
                {addrLink(x.address)}
              </span>
            ) : null}
          </Link>
        </span>
      </Td>
      <Td>
        {produzindo ? (
          <Selo tom="violeta">
            <span className="inline-flex items-center gap-1.5">
              <span className="scan-live" style={{ width: 5, height: 5 }} aria-hidden />
              {t("scanLists.vProducing")}
            </span>
          </Selo>
        ) : standby ? (
          <Selo tom="aviso">{t("scanLists.vStandby")}</Selo>
        ) : perf ? (
          <Selo tom={TOM_SAUDE[perf.status]}>
            {t(CHAVE_SAUDE[perf.status])} · {num(perf.score)}
          </Selo>
        ) : (
          <Selo tom="ok">{t("scanLists.vActive")}</Selo>
        )}
      </Td>
      <Td right className="whitespace-nowrap tnum">
        {fmtCompact(x.staked)}
      </Td>
      <Td right className="whitespace-nowrap tnum text-muted">
        {x.votes != null ? fmtCompact(x.votes) : "—"}
      </Td>
      <Td right className="tnum text-muted">
        {standby ? "—" : `${num(pct)}%`}
      </Td>
      {temPerf ? (
        <Td right className="tnum text-muted">
          {perf ? num(perf.produced) : "—"}
        </Td>
      ) : null}
      {temPerf ? (
        <Td right className="tnum text-muted">
          {perf ? `${num(perf.productivityPct)}%` : "—"}
        </Td>
      ) : null}
    </Tr>
  );
}
