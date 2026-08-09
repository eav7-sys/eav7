import Link from "next/link";
import type { Status, TxDetail } from "@/lib/api";
import { TxBadge } from "@/components/tx-badge";
import { ago, energyCost, fmt, fmtToken, num, shortHash, when } from "@/lib/format";
import {
  BackLink,
  DetailPage,
  Dot,
  Glass,
  HashWithCopy,
  Kv,
  KvRow,
  Mono,
  SectionTitle,
  avatarBg,
  destOf,
  txOk,
  type T,
} from "./shell";

/** Caixa "de"/"para" do cartão de destaque: bolinha + apelido curto + hash. */
function Party({ addr, label }: { addr: string; label: string }) {
  return (
    <Link
      href={`/address/${addr}`}
      aria-label={`${label}: ${addr}`}
      className="flex min-w-0 items-center gap-2.5 rounded-xl border border-[var(--scan-border)] bg-[var(--scan-hover)] py-2 pl-2 pr-3.5 transition-colors hover:border-violet"
    >
      <span
        aria-hidden
        className="inline-block size-8 shrink-0 rounded-[10px]"
        style={{ background: avatarBg(addr) }}
      />
      <span className="min-w-0">
        <span className="block whitespace-nowrap text-[13.5px] font-bold text-violet">{shortHash(addr, 8, 5)}</span>
        <span className="font-mono mt-px block text-[11px] text-faint">{label}</span>
      </span>
    </Link>
  );
}

/**
 * Tela de DETALHE DA TRANSAÇÃO.
 *
 * Recibo: só transação EAVM tem `receipt`. A AUSÊNCIA dele não é falha — é uma
 * transação nativa, que só entra no bloco se foi aplicada. Por isso `txOk()`
 * devolve `true` quando não há recibo, e nunca exibimos "falhou" por omissão.
 *
 * Omitido do desenho por falta de dado real: valor em dólar (a EAV7 não publica
 * preço), a lista de "validadores que confirmaram" (não há assinaturas por
 * transação na API) e a "nota privada" (o explorador não tem contas). O medidor de
 * energia/banda virou número: sem um teto real, a barra seria uma porcentagem
 * inventada.
 */
export function TxView({ res, status, t }: { res: TxDetail; status: Status | null; t: T }) {
  const tx = res.tx;
  const ok = txOk(tx);
  // Numa chamada EAVM o destino é o CONTRATO, que vem em `data.to`.
  const destino = destOf(tx);
  const altura = res.blockHeight ?? tx.blockHeight;
  const quando = res.blockTime ?? tx.timestamp;

  const confirmacoes = status != null && altura != null ? Math.max(1, status.height - altura + 1) : null;
  const finalizado = status != null && status.finalizedHeight >= 0 && altura != null && altura <= status.finalizedHeight;

  const simbolo = tx.asset?.kind === "EAV20" ? (tx.asset.symbol ?? "EAV20") : "EAV7";
  const quantia =
    tx.asset?.kind === "EAV721"
      ? `#${tx.asset.tokenId ?? "—"}`
      : tx.asset?.kind === "EAV20"
        ? fmtToken(tx.amount, tx.asset.decimals ?? 0)
        : fmt(tx.amount);
  const temValor = tx.asset != null || (tx.amount != null && tx.amount !== "0");

  // Camada EAVM: os três campos do mundo 0x viajam dentro de `data`.
  const evm = tx.data as { eavmFrom?: string; eavmTo?: string; eavmHash?: string } | undefined;
  const EAVM_KEYS = new Set(["eavmFrom", "eavmTo", "eavmHash"]);
  const dados = Object.entries(tx.data ?? {}).filter(([k, v]) => !EAVM_KEYS.has(k) && v != null && v !== "");

  return (
    <DetailPage>
      <BackLink href="/txs" label={t("scan_detail.back")} />
      <h1 className="font-display mb-5 text-[26px] font-extrabold tracking-tight text-ink">
        {t("scan_detail.txTitle")}
      </h1>

      {/* Cartão de destaque: quem → quanto → para quem, lido de uma vez. */}
      <div
        className="scan-glass flex flex-wrap items-center gap-4 px-7 py-5"
        style={{
          background:
            "linear-gradient(135deg, color-mix(in srgb, var(--violet) 16%, transparent), transparent), var(--scan-card)",
          borderColor: "color-mix(in srgb, var(--violet) 35%, transparent)",
        }}
      >
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-full text-[17px] font-bold ${
            ok ? "text-ok" : "text-red"
          }`}
          style={{ background: `color-mix(in srgb, var(--${ok ? "ok" : "red"}) 16%, transparent)` }}
          aria-hidden
        >
          {ok ? "✓" : "✕"}
        </span>

        <Party addr={tx.from} label={t("scan_detail.colFrom")} />

        <span className="text-[13px] text-muted">{t("scan_detail.transferred")}</span>

        <span className="flex items-baseline gap-2">
          <span className="tnum text-[22px] font-extrabold tracking-tight text-ink">
            {temValor ? quantia : "—"}
          </span>
          {tx.asset?.kind === "EAV20" ? (
            <Link
              href={`/token/${tx.asset.id}`}
              className="inline-flex items-center gap-1.5 self-center rounded-lg bg-[var(--scan-chip)] px-2.5 py-1 text-[12px] font-bold text-violet hover:underline"
            >
              <Dot seed={simbolo} size={15} radius={8} />
              {simbolo}
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1.5 self-center rounded-lg bg-[var(--scan-chip)] px-2.5 py-1 text-[12px] font-bold text-violet">
              <Dot seed={simbolo} size={15} radius={8} />
              {simbolo}
            </span>
          )}
        </span>

        {destino ? (
          <>
            <span className="text-[13px] text-muted">→ {t("scan_detail.toWord")}</span>
            <Party addr={destino} label={t("scan_detail.colTo")} />
          </>
        ) : (
          <span className="ml-auto">
            <TxBadge type={tx.type} />
          </span>
        )}
      </div>

      <Glass className="mt-4">
        <Kv className="px-7">
          <KvRow label={t("scan_detail.colHash")}>
            <HashWithCopy text={tx.id} head={28} tail={18} />
          </KvRow>

          <KvRow label={t("scan_detail.lblResult")}>
            <span className={`flex items-center gap-2 font-bold ${ok ? "text-ok" : "text-red"}`}>
              {ok ? "✓" : "✕"} {ok ? t("scan_detail.resultOk") : t("scan_detail.resultFail")}
            </span>
          </KvRow>

          <KvRow label={t("scan_detail.colType")}>
            <TxBadge type={tx.type} />
          </KvRow>

          <KvRow label={t("scan_detail.lblBlockTime")}>
            <span className="flex flex-wrap items-center gap-2.5">
              {altura != null ? (
                <Link href={`/block/${altura}`} className="font-semibold text-violet hover:underline">
                  #{num(altura)}
                </Link>
              ) : (
                <span className="text-faint">—</span>
              )}
              <span className="text-faint">|</span>
              <span className="text-muted">{ago(quando)}</span>
              <span className="text-faint">|</span>
              <span className="tnum">{when(quando)}</span>
            </span>
          </KvRow>

          <KvRow label={t("scan_detail.colStatus")}>
            <span className="flex flex-wrap items-center gap-2.5">
              <span className={`badge ${ok ? "badge-green" : "badge-red"}`}>{res.status}</span>
              {confirmacoes != null ? (
                <span className="text-[12.5px] text-muted">
                  {t("scan_detail.confirmations", { n: num(confirmacoes) })}
                </span>
              ) : null}
            </span>
          </KvRow>

          {status != null ? (
            <KvRow label={t("scan_detail.lblFinality")}>
              <span className={`badge ${finalizado ? "badge-green" : "badge-gold"}`}>
                {finalizado ? t("scan_detail.finalized") : t("scan_detail.pendingFinality")}
              </span>
            </KvRow>
          ) : null}

          <KvRow label={t("scan_detail.colFrom")}>
            <span className="flex min-w-0 items-center gap-2.5">
              <Dot seed={tx.from} />
              <Link href={`/address/${tx.from}`} className="min-w-0 font-mono text-violet hover:underline">
                <Mono text={tx.from} head={22} tail={12} />
              </Link>
            </span>
          </KvRow>

          <KvRow label={t("scan_detail.colTo")}>
            {destino ? (
              <span className="flex min-w-0 items-center gap-2.5">
                <Dot seed={destino} />
                <Link href={`/address/${destino}`} className="min-w-0 font-mono text-violet hover:underline">
                  <Mono text={destino} head={22} tail={12} />
                </Link>
              </span>
            ) : (
              <span className="text-faint">—</span>
            )}
          </KvRow>

          <KvRow label={t("scan_detail.lblValue")}>
            <span className="flex flex-wrap items-center gap-2.5">
              <Dot seed={simbolo} size={18} radius={9} />
              <span className="tnum text-[15px] font-extrabold text-ink">{temValor ? quantia : "—"}</span>
              <span className="font-bold text-violet">{simbolo}</span>
            </span>
          </KvRow>

          {tx.receipt?.contract ? (
            <KvRow label={t("scan_detail.lblContractCreated")}>
              <Link href={`/address/${tx.receipt.contract}`} className="min-w-0 font-mono text-violet hover:underline">
                <Mono text={tx.receipt.contract} head={22} tail={12} />
              </Link>
            </KvRow>
          ) : null}
        </Kv>
      </Glass>

      {/* Taxa e recursos. Sem barra de porcentagem: o nó não publica um TETO por
          transação, e uma barra sem denominador real seria um número inventado. */}
      <Glass className="mt-4">
        <div className="px-6 pb-1.5 pt-4 text-[13px] font-bold text-ink">{t("scan_detail.feeResources")}</div>
        <div className="px-6 pb-2">
          <div className="flex items-center justify-between border-t border-[var(--scan-border-soft)] py-2.5 text-[13px]">
            <span className="text-muted">{t("scan_detail.lblFee")}</span>
            <span className="tnum font-semibold">{fmt(tx.fee)} EAV7</span>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--scan-border-soft)] py-2.5 text-[13px]">
            <span className="text-muted">{t("scan_detail.lblEnergy")}</span>
            <span className="tnum font-semibold">{num(energyCost(tx.type))}</span>
          </div>
          {tx.receipt?.gasUsed ? (
            <div className="flex items-center justify-between border-t border-[var(--scan-border-soft)] py-2.5 text-[13px]">
              <span className="text-muted">{t("scan_detail.lblGasEavm")}</span>
              <span className="tnum font-semibold">{num(Number(tx.receipt.gasUsed))}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-between border-t border-[var(--scan-border-soft)] py-2.5 text-[13px]">
            <span className="text-muted">{t("scan_detail.lblNonce")}</span>
            <span className="tnum font-semibold">{num(tx.nonce)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--scan-border-soft)] py-2.5 text-[13px]">
            <span className="text-muted">{t("scan_detail.lblScheme")}</span>
            <span className="font-mono">{tx.scheme ?? "eav7-hybrid-1"}</span>
          </div>
        </div>
      </Glass>

      {evm?.eavmHash ? (
        <>
          <SectionTitle>{t("scan_detail.eavmLayer")}</SectionTitle>
          <Glass>
            <Kv className="px-6">
              <KvRow label="0x from">
                <Mono text={evm.eavmFrom ?? "—"} head={26} tail={12} />
              </KvRow>
              <KvRow label="0x to">
                <Mono text={evm.eavmTo ?? "—"} head={26} tail={12} />
              </KvRow>
              <KvRow label="0x hash">
                <HashWithCopy text={evm.eavmHash} head={28} tail={16} />
              </KvRow>
            </Kv>
          </Glass>
        </>
      ) : null}

      {/* Dados de entrada: o payload REAL da transação, não uma calldata de exemplo. */}
      <Glass className="mt-4 px-6 py-5">
        <div className="mb-2.5 text-[13px] font-bold text-ink">{t("scan_detail.inputData")}</div>
        {dados.length > 0 ? (
          <pre className="font-mono scan-input overflow-x-auto whitespace-pre-wrap break-all p-3.5 text-[11.5px] leading-[1.7] text-muted">
            {JSON.stringify(Object.fromEntries(dados), null, 2)}
          </pre>
        ) : (
          <p className="text-[12.5px] text-faint">{t("scan_detail.noInputData")}</p>
        )}
      </Glass>
    </DetailPage>
  );
}
