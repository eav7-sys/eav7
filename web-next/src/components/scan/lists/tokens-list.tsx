"use client";

import Link from "next/link";
import { type TokenSummary } from "@/lib/api";
import { fmtToken, num, shortHash, whenUtc } from "@/lib/format";
import { useT } from "@/i18n/provider";
import { Cartao, ListaShell, Selo, Td, Th, Tr, Vazio, corDe } from "./table";

const COLUNAS = 6;

interface Props {
  tokens: TokenSummary[];
}

export function TokensList({ tokens }: Props) {
  const t = useT();

  return (
    <ListaShell titulo={t("scanLists.titleTokens")}>
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

  return (
    <Tr>
      <Td className="text-faint">{posicao}</Td>
      <Td>
        <span className="flex items-center gap-3">
          <span
            className="flex size-[30px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
            style={{ background: corDe(k.id) }}
            aria-hidden
          >
            {iniciais}
          </span>
          <Link href={`/token/${k.id}`} className="min-w-0 truncate font-semibold text-violet hover:underline">
            {k.name} <span className="text-xs font-normal text-faint">{k.symbol}</span>
          </Link>
          {k.paused ? <Selo tom="aviso">{rotuloPausado}</Selo> : null}
        </span>
      </Td>
      <Td right className="whitespace-nowrap font-medium">
        {fmtToken(k.totalSupply, k.decimals)} {k.symbol}
      </Td>
      <Td right className="text-muted">
        {num(k.holders)}
      </Td>
      <Td>
        <Link
          href={`/address/${k.creator}`}
          className="block truncate pr-3 font-mono text-[12.5px] text-violet hover:underline"
        >
          {shortHash(k.creator, 10, 6)}
        </Link>
      </Td>
      <Td right className="whitespace-nowrap text-muted">
        {k.createdAt ? whenUtc(k.createdAt) : "—"}
      </Td>
    </Tr>
  );
}
