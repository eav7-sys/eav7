import Link from "next/link";
import type { BlockDetail, Status, Tx } from "@/lib/api";
import { TxBadge } from "@/components/tx-badge";
import { ago, energyCost, fmt, fmtBytes, num, shortHash, when } from "@/lib/format";
import {
  Amount,
  BackLink,
  DetailPage,
  Dot,
  EmptyRow,
  Glass,
  HashWithCopy,
  Kv,
  KvRow,
  Mono,
  ResultBadge,
  SectionTitle,
  txOk,
  type T,
} from "./shell";

/**
 * Tela de DETALHE DO BLOCO.
 *
 * Diferenças conscientes em relação ao desenho, todas pela mesma razão — o desenho
 * foi feito sobre dados fictícios e pede números que a EAV7 não publica:
 *   · "Tamanho (KB)"  → o nó não expõe o tamanho serializado do bloco.
 *   · "Gas usado"     → na EAV7 o custo é ENERGIA por tipo de transação; somamos a
 *                       energia real do bloco e, à parte, o gás da VM quando há
 *                       transações EAVM (que trazem `gasUsed` no recibo).
 *   · "Recompensa"    → o nó publica a recompensa VIGENTE da rede, não a paga neste
 *                       bloco; por isso o rótulo diz "da rede" e some sem /status.
 */
export function BlockView({ block, status, t }: { block: BlockDetail; status: Status | null; t: T }) {
  const txs: Tx[] = block.transactions ?? [];

  // Finalidade BFT (#2): o bloco é final quando sua altura já foi finalizada.
  const finalizado = status != null && status.finalizedHeight >= 0 && block.height <= status.finalizedHeight;

  // Energia consumida = soma do custo por tipo (espelha CHAIN.ENERGY.COST do nó).
  const energia = txs.reduce((soma, x) => soma + energyCost(x.type), 0);
  // Gás da VM só existe em transação EAVM, e vem do recibo de execução.
  const gasEavm = txs.reduce((soma, x) => soma + Number(x.receipt?.gasUsed ?? 0), 0);
  const taxas = txs.reduce((soma, x) => {
    try {
      return soma + BigInt(x.fee || "0");
    } catch {
      return soma;
    }
  }, 0n);

  return (
    <DetailPage>
      <BackLink href="/blocks" label={t("scanLists.titleBlocks")} />

      <div className="mb-5 flex flex-wrap items-center gap-3.5">
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-ink">
          {t("scan_detail.bkTitle")} #{num(block.height)}
        </h1>
        {status != null ? (
          <span className={`badge ${finalizado ? "badge-green" : "badge-gold"}`}>
            {finalizado ? t("scan_detail.finalized") : t("scan_detail.pendingFinality")}
          </span>
        ) : null}
      </div>

      <Glass>
        <Kv>
          {block.hash ? (
            <KvRow label={t("scan_detail.colHash")}>
              <HashWithCopy text={block.hash} />
            </KvRow>
          ) : null}

          <KvRow label={t("scan_detail.lblParent")}>
            {block.previousHash && block.height > 0 ? (
              // Linka pela ALTURA (height − 1), que é o pai por definição — não
              // dependemos de o nó aceitar consulta de bloco por hash.
              <Link href={`/block/${block.height - 1}`} className="min-w-0 font-mono text-violet hover:underline">
                <Mono text={block.previousHash} />
              </Link>
            ) : (
              <span className="text-faint">—</span>
            )}
          </KvRow>

          <KvRow label={t("scan_detail.lblTimestamp")}>
            <span className="tnum">
              {when(block.timestamp)} <span className="text-faint">({ago(block.timestamp)})</span>
            </span>
          </KvRow>

          <KvRow label={t("scan_detail.lblProducer")}>
            <span className="flex min-w-0 items-center gap-2.5">
              <Dot seed={block.producer} />
              <Link href={`/address/${block.producer}`} className="min-w-0 font-mono text-violet hover:underline">
                <Mono text={block.producer} head={18} tail={10} />
              </Link>
            </span>
          </KvRow>

          <KvRow label={t("scan_detail.lblTxs")}>
            <span className="tnum">{num(block.txCount)}</span>
          </KvRow>

          <KvRow label={t("scan_detail.lblSize")}>
            <span className="tnum">{fmtBytes(block.size)}</span>
          </KvRow>

          <KvRow label={t("scan_detail.lblEnergy")}>
            <span className="tnum">
              {num(energia)}
              {gasEavm > 0 ? (
                <span className="text-faint"> · {t("scan_detail.lblGasEavm")} {num(gasEavm)}</span>
              ) : null}
            </span>
          </KvRow>

          <KvRow label={t("scan_detail.lblFees")}>
            <span className="tnum">{fmt(taxas)} EAV7</span>
          </KvRow>

          {status?.blockReward ? (
            <KvRow label={t("scan_detail.lblReward")}>
              <span className="tnum font-semibold text-ok">+{fmt(status.blockReward)} EAV7</span>
            </KvRow>
          ) : null}

          {block.txRoot ? (
            <KvRow label={t("scan_detail.lblMerkle")}>
              <Mono text={block.txRoot} />
            </KvRow>
          ) : null}

          <KvRow label={t("scan_detail.lblProtocol")}>
            <span className="font-mono">
              {block.protocol ?? "eav20"} · {block.scheme ?? "eav7-hybrid-1"}
            </span>
          </KvRow>
        </Kv>
      </Glass>

      <SectionTitle>
        {t("scan_detail.txsInBlock")} <span className="text-muted">({num(block.txCount)})</span>
      </SectionTitle>

      <Glass className="overflow-hidden">
        <div className="scan-scroll">
          <table className="scan-table">
            <thead>
              <tr>
                <th>{t("scan_detail.colHash")}</th>
                <th>{t("scan_detail.colType")}</th>
                <th>{t("scan_detail.colFrom")}</th>
                <th>{t("scan_detail.colTo")}</th>
                <th className="!text-right">{t("scan_detail.colAmount")}</th>
                <th className="!text-right">{t("scan_detail.colResult")}</th>
              </tr>
            </thead>
            <tbody>
              {txs.map((x) => (
                <tr key={x.id}>
                  <td className="max-w-[220px]">
                    <Link href={`/tx/${x.id}`} className="font-mono text-violet hover:underline">
                      {shortHash(x.id, 12, 6)}
                    </Link>
                  </td>
                  <td>
                    <TxBadge type={x.type} />
                  </td>
                  <td>
                    <Link href={`/address/${x.from}`} className="font-mono text-violet hover:underline">
                      {shortHash(x.from, 6, 4)}
                    </Link>
                  </td>
                  <td>
                    {x.to ? (
                      <Link href={`/address/${x.to}`} className="font-mono text-violet hover:underline">
                        {shortHash(x.to, 6, 4)}
                      </Link>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="text-right font-semibold">
                    <Amount tx={x} />
                  </td>
                  <td className="text-right">
                    <ResultBadge ok={txOk(x)} t={t} />
                  </td>
                </tr>
              ))}
              {txs.length === 0 ? <EmptyRow cols={6}>{t("scan_detail.emptyBlock")}</EmptyRow> : null}
            </tbody>
          </table>
        </div>
      </Glass>
    </DetailPage>
  );
}
