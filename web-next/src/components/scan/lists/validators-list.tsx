"use client";

import Link from "next/link";
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
import { fmt, fmtCompact, num, shortHash } from "@/lib/format";
import { useT, type TFunc } from "@/i18n/provider";
import { Cartao, ListaShell, Selo, Td, Th, Tr, Vazio, corDe } from "./table";

interface Props {
  inicial: Validators | null;
  status: Status | null;
}

// Peso de eleição = self-stake + votos recebidos. É o critério do conjunto ativo.
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

export function ValidatorsList({ inicial, status }: Props) {
  const t = useT();

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
      <ListaShell titulo={t("scanLists.titleValidators")}>
        <div className="scan-glass p-10 text-center text-[13px] text-muted">
          {t("scanLists.unavailable")}
        </div>
      </ListaShell>
    );
  }

  const lista = [...v.current].sort((a, b) => (pesoDe(b) > pesoDe(a) ? 1 : pesoDe(b) < pesoDe(a) ? -1 : 0));
  const pesoTotal = lista.reduce((acc, x) => acc + pesoDe(x), 0n);
  const produtor = st?.producer ?? v.slotProducer;
  const perfPor = new Map<string, ValidatorPerf>((v.performance ?? []).map((p) => [p.address, p]));
  // O produtor do slot vem como ENDEREÇO em `slotProducer`; o nome dele está na
  // entrada correspondente de `current`.
  const nomePor = new Map<string, string>(
    (v.current ?? []).flatMap((x) => (x.name ? [[x.address, x.name] as [string, string]] : [])),
  );
  const temPerf = perfPor.size > 0;
  const colunas = temPerf ? 8 : 6;

  // Fatia do circulante que está em stake/voto. Os dois números vêm do estado da
  // cadeia (em e7), então a razão é real — não há métrica pronta na API.
  const circulante = st ? BigInt(st.circulating || "0") : 0n;
  const taxaStake =
    circulante > 0n ? `${num(Number((pesoTotal * 10000n) / circulante) / 100)}%` : "—";

  return (
    <ListaShell titulo={t("scanLists.titleValidators")}>
      <div className="mb-5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Cartao4 rotulo={t("scanLists.cardValidators")}>
          {num(lista.length)}
          <span className="text-base font-semibold text-faint"> / {num(v.maxValidators)}</span>
        </Cartao4>
        <Cartao4 rotulo={t("scanLists.cardProducing")}>
          <span className="flex items-center gap-2">
            <span className="scan-live" aria-hidden />
            {produtor ? (
              <Link href={`/address/${produtor}`} className="font-mono text-[15px] text-violet hover:underline">
                {nomePor.get(produtor) ?? shortHash(produtor, 8, 4)}
              </Link>
            ) : (
              "—"
            )}
          </span>
        </Cartao4>
        <Cartao4 rotulo={t("scanLists.cardStakeRate")}>{taxaStake}</Cartao4>
        <Cartao4 rotulo={t("scanLists.cardBlockReward")}>
          {fmt(v.blockReward)} <span className="text-base font-semibold text-faint">EAV7</span>
        </Cartao4>
      </div>

      <Cartao>
        <table className="w-full min-w-[900px] border-collapse">
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
              <Vazio colunas={colunas} msg={t("scanLists.emptyValidators")} />
            ) : (
              lista.map((x, i) => (
                <LinhaValidador
                  key={x.address}
                  x={x}
                  posicao={i + 1}
                  produzindo={x.address === produtor}
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

function Cartao4({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="scan-glass px-[18px] py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">{rotulo}</div>
      <div className="mt-[7px] text-xl font-bold text-ink">{children}</div>
    </div>
  );
}

function LinhaValidador({
  x,
  posicao,
  produzindo,
  perf,
  temPerf,
  pesoTotal,
  nome,
  t,
}: {
  x: Validator;
  posicao: number;
  produzindo: boolean;
  perf: ValidatorPerf | null;
  temPerf: boolean;
  pesoTotal: bigint;
  nome?: string;
  t: TFunc;
}) {
  const peso = pesoDe(x);
  const pct = pesoTotal > 0n ? Number((peso * 10000n) / pesoTotal) / 100 : 0;

  return (
    <Tr>
      <Td className="font-semibold text-faint">{posicao}</Td>
      <Td>
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className="inline-block size-[18px] shrink-0 rounded-md"
            style={{ background: corDe(x.address) }}
            aria-hidden
          />
          <Link
            href={`/address/${x.address}`}
            className={`truncate font-semibold text-violet hover:underline ${nome ? "" : "font-mono text-[12.5px]"}`}
          >
            {nome ?? shortHash(x.address, 10, 6)}
          </Link>
        </span>
      </Td>
      <Td>
        {produzindo ? (
          <Selo tom="violeta">{t("scanLists.vProducing")}</Selo>
        ) : perf ? (
          <Selo tom={TOM_SAUDE[perf.status]}>
            {t(CHAVE_SAUDE[perf.status])} · {num(perf.score)}
          </Selo>
        ) : (
          <Selo tom="ok">{t("scanLists.vActive")}</Selo>
        )}
      </Td>
      <Td right className="whitespace-nowrap">
        {fmtCompact(x.staked)}
      </Td>
      <Td right className="whitespace-nowrap text-muted">
        {x.votes != null ? fmtCompact(x.votes) : "—"}
      </Td>
      <Td right className="text-muted">
        {num(pct)}%
      </Td>
      {temPerf ? (
        <Td right className="text-muted">
          {perf ? num(perf.produced) : "—"}
        </Td>
      ) : null}
      {temPerf ? (
        <Td right className="text-muted">
          {perf ? `${num(perf.productivityPct)}%` : "—"}
        </Td>
      ) : null}
    </Tr>
  );
}
