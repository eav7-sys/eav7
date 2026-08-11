"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getBlocks, type Block } from "@/lib/api";
import { ago, fmt, fmtBytes, num, shortHash } from "@/lib/format";
import { useT } from "@/i18n/provider";
import { Cartao, ListaShell, Paginacao, Td, Th, Tr, Vazio, corDe } from "./table";

const POR_PAGINA = 25;
const COLUNAS = 7;

interface Props {
  inicial: Block[];
  /** Altura do topo da cadeia — dá o total para o rótulo "de N". */
  altura: number | null;
  /** Recompensa por bloco (constante da cadeia, vinda de /status). */
  recompensa: string | null;
  /** endereço → nome EAV-NS, quando existe. */
  nomes: Record<string, string>;
}

export function BlocksList({ inicial, altura, recompensa, nomes }: Props) {
  const t = useT();
  const [pagina, setPagina] = useState(0);

  const q = useQuery({
    queryKey: ["scan-blocks", pagina, altura],
    // Com `?from=` a API devolve uma faixa de altura fixa (limit ≤ 200). Página N
    // pede exatamente POR_PAGINA(+1 sonda), sem over-fetch O(page).
    queryFn: async () => {
      if (altura == null) {
        const tip = await getBlocks(POR_PAGINA + 1);
        return {
          linhas: tip.slice(0, POR_PAGINA),
          temMais: tip.length > POR_PAGINA,
        };
      }
      const from = Math.max(0, altura - (pagina + 1) * POR_PAGINA + 1);
      const faixa = await getBlocks(POR_PAGINA + 1, from);
      const desc = [...faixa].reverse();
      return {
        linhas: desc.slice(0, POR_PAGINA),
        temMais: from > 0,
      };
    },
    initialData:
      pagina === 0
        ? { linhas: inicial.slice(0, POR_PAGINA), temMais: inicial.length > POR_PAGINA }
        : undefined,
    // Só o topo é "ao vivo": páginas antigas não mudam e recarregá-las é ruído.
    refetchInterval: pagina === 0 ? 5000 : false,
    placeholderData: keepPreviousData,
  });

  const linhas = q.data?.linhas ?? [];
  const total = altura != null ? altura + 1 : null;
  const de = pagina * POR_PAGINA + 1;
  const ate = de + Math.max(0, linhas.length - 1);

  const rotulo =
    total != null && linhas.length > 0
      ? t("scanLists.showingRange", { from: num(de), to: num(ate), total: num(total) })
      : t("scanLists.pageN", { n: pagina + 1 });

  return (
    <ListaShell titulo={t("scanLists.titleBlocks")}>
      <Cartao>
        <table className="w-full min-w-[980px] border-collapse">
          <colgroup>
            <col style={{ width: 110 }} />
            <col />
            <col style={{ width: 110 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: "26%" }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 150 }} />
          </colgroup>
          <thead>
            <tr>
              <Th>{t("scanLists.colHeight")}</Th>
              <Th>{t("scanLists.colHash")}</Th>
              <Th>{t("scanLists.colAge")}</Th>
              <Th>{t("scanLists.colTxsN")}</Th>
              <Th>{t("scanLists.colProducer")}</Th>
              <Th right>{t("scanLists.colSize")}</Th>
              <Th right>{t("scanLists.colReward")}</Th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 ? (
              <Vazio colunas={COLUNAS} msg={t("scanLists.emptyBlocks")} />
            ) : (
              linhas.map((b) => <LinhaBloco key={b.height} b={b} recompensa={recompensa} nomes={nomes} />)
            )}
          </tbody>
        </table>
        <Paginacao
          rotulo={rotulo}
          rotuloAnterior={t("scanLists.prev")}
          rotuloProxima={t("scanLists.next")}
          anterior={pagina > 0 ? () => setPagina((p) => Math.max(0, p - 1)) : null}
          proxima={q.data?.temMais ? () => setPagina((p) => p + 1) : null}
        />
      </Cartao>
    </ListaShell>
  );
}

function LinhaBloco({
  b,
  recompensa,
  nomes,
}: {
  b: Block;
  recompensa: string | null;
  nomes: Record<string, string>;
}) {
  const nome = nomes[b.producer];
  // O gênese não paga recompensa de produção; nos demais o valor é a constante
  // da cadeia (/status.blockReward) — não há recompensa por bloco na API.
  const premio = b.height === 0 || !recompensa ? "—" : `+${fmt(recompensa)} EAV7`;

  return (
    <Tr>
      <Td>
        <Link href={`/block/${b.height}`} className="font-semibold text-violet hover:underline">
          #{num(b.height)}
        </Link>
      </Td>
      <Td className="text-muted">
        <span className="block truncate pr-4 font-mono">{shortHash(b.hash, 14, 8)}</span>
      </Td>
      <Td className="whitespace-nowrap text-muted">{ago(b.timestamp)}</Td>
      <Td>{num(b.txCount)}</Td>
      <Td>
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="inline-block size-4 shrink-0 rounded-full"
            style={{ background: corDe(b.producer) }}
            aria-hidden
          />
          <Link
            href={`/address/${b.producer}`}
            className={`truncate text-violet hover:underline ${nome ? "" : "font-mono text-[12.5px]"}`}
          >
            {nome ?? shortHash(b.producer, 10, 6)}
          </Link>
        </span>
      </Td>
      <Td right className="whitespace-nowrap tnum text-muted">
        {fmtBytes(b.size)}
      </Td>
      <Td right className="whitespace-nowrap font-medium text-ok">
        {premio}
      </Td>
    </Tr>
  );
}
