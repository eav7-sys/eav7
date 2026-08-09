"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getTxs, type Tx, type TxPage } from "@/lib/api";
import { ago, fmt, fmtToken, num, shortHash } from "@/lib/format";
import { useT } from "@/i18n/provider";
import { Cartao, ListaShell, Paginacao, Selo, Td, Th, Tr, Vazio } from "./table";

const POR_PAGINA = 25;
const COLUNAS = 7;

interface Props {
  inicial: TxPage | null;
  /** Total de transações da rede (/stats) — usado só como contexto no rodapé. */
  total: number | null;
}

export function TxsList({ inicial, total }: Props) {
  const t = useT();
  // A API pagina por cursor (`before`), não por índice: para voltar é preciso
  // lembrar por onde passamos. A pilha guarda os cursores já visitados.
  const [pilha, setPilha] = useState<number[]>([]);
  const cursor = pilha.length ? pilha[pilha.length - 1] : undefined;

  const q = useQuery({
    queryKey: ["scan-txs", cursor ?? "topo"],
    queryFn: () => getTxs(POR_PAGINA, cursor),
    initialData: pilha.length === 0 ? (inicial ?? undefined) : undefined,
    refetchInterval: pilha.length === 0 ? 4000 : false,
    placeholderData: keepPreviousData,
  });

  const linhas = q.data?.txs ?? [];
  const proximoCursor = q.data?.nextBefore ?? null;

  return (
    <ListaShell titulo={t("scanLists.titleTxs")}>
      <Cartao>
        <table className="w-full min-w-[980px] border-collapse">
          <colgroup>
            <col style={{ width: "20%" }} />
            <col style={{ width: 150 }} />
            <col style={{ width: "17%" }} />
            <col style={{ width: "17%" }} />
            <col style={{ width: 170 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 120 }} />
          </colgroup>
          <thead>
            <tr>
              <Th>{t("scanLists.colHash")}</Th>
              <Th>{t("scanLists.colType")}</Th>
              <Th>{t("scanLists.colFrom")}</Th>
              <Th>{t("scanLists.colTo")}</Th>
              <Th right>{t("scanLists.colAmount")}</Th>
              <Th right>{t("scanLists.colAge")}</Th>
              <Th right>{t("scanLists.colStatus")}</Th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 ? (
              <Vazio colunas={COLUNAS} msg={t("scanLists.emptyTxs")} />
            ) : (
              linhas.map((x) => <LinhaTx key={x.id} x={x} t={t} />)
            )}
          </tbody>
        </table>
        <Paginacao
          rotulo={
            <span className="flex flex-wrap items-center gap-2">
              <span>{t("scanLists.pageN", { n: pilha.length + 1 })}</span>
              {total != null ? (
                <span className="text-faint">{t("scanLists.totalTxs", { n: num(total) })}</span>
              ) : null}
            </span>
          }
          rotuloAnterior={t("scanLists.prev")}
          rotuloProxima={t("scanLists.next")}
          anterior={pilha.length > 0 ? () => setPilha((p) => p.slice(0, -1)) : null}
          proxima={
            proximoCursor != null && linhas.length > 0
              ? () => setPilha((p) => [...p, proximoCursor])
              : null
          }
        />
      </Cartao>
    </ListaShell>
  );
}

/**
 * Valor movido. Quando a tx carrega um ativo EAV20/EAV721, o número está nas
 * casas decimais DELE — formatar com as 6 do EAV7 daria um valor errado.
 */
function valorDe(x: Tx): string {
  if (x.asset?.kind === "EAV721") {
    return `#${x.asset.tokenId ?? "?"} ${x.asset.symbol ?? ""}`.trim();
  }
  if (x.asset?.kind === "EAV20") {
    return `${fmtToken(x.amount, x.asset.decimals ?? 0)} ${x.asset.symbol ?? "EAV20"}`;
  }
  if (!x.amount || x.amount === "0") return "—";
  return `${fmt(x.amount)} EAV7`;
}

function LinhaTx({ x, t }: { x: Tx; t: (k: string) => string }) {
  // Uma tx listada já está em bloco: só o recibo do EAVM pode dizer que ela
  // reverteu. Sem recibo, aplicada com sucesso.
  const falhou = x.receipt ? x.receipt.success === false : false;

  return (
    <Tr>
      <Td>
        <Link href={`/tx/${x.id}`} className="block truncate pr-3 font-mono text-violet hover:underline">
          {shortHash(x.id, 12, 6)}
        </Link>
      </Td>
      <Td>
        <span className="inline-block rounded-md bg-[var(--scan-chip)] px-2 py-[3px] text-[10.5px] font-semibold text-violet">
          {x.type.toLowerCase()}
        </span>
      </Td>
      <Td>
        <Link
          href={`/address/${x.from}`}
          className="block truncate pr-3 font-mono text-[12.5px] text-violet hover:underline"
        >
          {shortHash(x.from, 8, 4)}
        </Link>
      </Td>
      <Td>
        {x.to ? (
          <Link
            href={`/address/${x.to}`}
            className="block truncate pr-3 font-mono text-[12.5px] text-violet hover:underline"
          >
            {shortHash(x.to, 8, 4)}
          </Link>
        ) : (
          <span className="text-faint">—</span>
        )}
      </Td>
      <Td right className="whitespace-nowrap font-semibold">
        {valorDe(x)}
      </Td>
      <Td right className="whitespace-nowrap text-muted">
        {x.timestamp ? ago(x.timestamp) : "—"}
      </Td>
      <Td right>
        <Selo tom={falhou ? "erro" : "ok"}>
          {falhou ? t("scanLists.stFailed") : t("scanLists.stConfirmed")}
        </Selo>
      </Td>
    </Tr>
  );
}
