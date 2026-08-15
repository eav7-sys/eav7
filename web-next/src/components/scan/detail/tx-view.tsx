import Link from "next/link";
import type { Status, TxDetail, Validator } from "@/lib/api";
import { TxBadge } from "@/components/tx-badge";
import { ago, energyCost, fmt, fmtNsName, fmtToken, fmtUsd, num, shortHash, when } from "@/lib/format";
import { e7ToHuman, getMarketPrice } from "@/lib/price-market";
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

/** Caixa "de"/"para" do cartão de destaque — fiel ao EAVScan.dc.html (nome + hash curto). */
function Party({ addr, label }: { addr: string; label: string }) {
  const name = shortHash(addr, 8, 5);
  const short = shortHash(addr, 6, 4);
  return (
    <Link
      href={`/address/${addr}`}
      aria-label={`${label}: ${addr}`}
      className="flex min-w-0 items-center gap-2.5 rounded-xl border border-[var(--scan-border)] bg-[var(--input-bg,var(--scan-hover))] py-2 pl-2 pr-3.5 transition-colors hover:border-[var(--violet-deep)]"
    >
      <span
        aria-hidden
        className="inline-block size-8 shrink-0 rounded-[10px]"
        style={{ background: avatarBg(addr) }}
      />
      <span className="min-w-0">
        <span className="block whitespace-nowrap text-[13.5px] font-bold text-violet">{name}</span>
        <span className="font-mono mt-px block text-[11px] text-faint">{short}</span>
      </span>
    </Link>
  );
}

/** Teto de fee do protocolo (`MAX_FEE_LIMIT` = 100 EAV7). */
const FEE_LIMIT_E7 = 100;
/** Escala visual do mock EAVScan para bytes ponderados por tx. */
const GB_BAR_DENOM = 64_000;
/** Escala visual do mock EAVScan para gas EAVM. */
const GAS_BAR_DENOM = 480_000;

function estimateWeightedBytes(tx: TxDetail["tx"]): number {
  const raw = tx.data?.raw;
  if (typeof raw === "string" && raw.startsWith("0x") && raw.length > 2) {
    return Math.max(1, Math.floor((raw.length - 2) / 2));
  }
  // Fallback alinhado ao mock do design (sem inventar volume absurdo).
  return Math.max(800, energyCost(tx.type) * 400);
}

function ResourceBar({
  pct,
  gradient,
}: {
  pct: number;
  gradient: string;
}) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="mt-[9px] h-1.5 overflow-hidden rounded-[3px] bg-[var(--input-bg,var(--scan-hover))]">
      <div
        className="h-full rounded-[3px] transition-[width] duration-300"
        style={{ width: `${w}%`, background: gradient }}
      />
    </div>
  );
}

function FeeResources({ tx, t }: { tx: TxDetail["tx"]; t: T }) {
  const spot = getMarketPrice();
  const feeHuman = e7ToHuman(tx.fee);
  const feeUsd = feeHuman * spot.priceUsd;
  const gbBytes = estimateWeightedBytes(tx);
  const gbPct = Math.min(100, Math.round((gbBytes / GB_BAR_DENOM) * 100));
  const burnPct = Math.min(100, Math.round((feeHuman / FEE_LIMIT_E7) * 100));
  const gasUsed = tx.receipt?.gasUsed != null ? Number(tx.receipt.gasUsed) : null;
  const gasPct =
    gasUsed != null && Number.isFinite(gasUsed)
      ? Math.min(100, Math.round((gasUsed / GAS_BAR_DENOM) * 100))
      : null;

  return (
    <Glass className="mt-4">
      <div className="px-6 pb-1.5 pt-3.5 text-[13px] font-bold text-ink">{t("scan_detail.feeResources")}</div>
      <div className="px-6 pb-2.5">
        <div className="flex items-center justify-between border-t border-[var(--scan-border-soft)] py-[11px] text-[13px]">
          <span className="text-muted">{t("scan_detail.lblFee")}</span>
          <span className="font-semibold">
            {fmt(tx.fee)} EAV7{" "}
            <span className="font-normal text-faint">≈ {fmtUsd(feeUsd, feeUsd < 0.01 ? 6 : 4)}</span>
          </span>
        </div>

        <div className="border-t border-[var(--scan-border-soft)] py-[11px] text-[13px]">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-[7px] text-muted">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinejoin="round" aria-hidden>
                <path d="M12 2 2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
              {t("scan_detail.lblGb")}
            </span>
            <span className="font-semibold tabular-nums">{gbBytes.toLocaleString("pt-BR")} B</span>
          </div>
          <ResourceBar pct={gbPct} gradient="linear-gradient(90deg,#6336C4,#9F7BFF)" />
        </div>

        <div className="border-t border-[var(--scan-border-soft)] py-[11px] text-[13px]">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-[7px] text-muted">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--red,#E74C3C)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
              </svg>
              {t("scan_detail.lblBurn")}
            </span>
            <span className="font-semibold text-[var(--red,#E74C3C)]">{fmt(tx.fee)} EAV7</span>
          </div>
          <ResourceBar pct={burnPct} gradient="linear-gradient(90deg,#E74C3C,#F0846F)" />
        </div>

        <div className="flex items-center justify-between border-t border-[var(--scan-border-soft)] py-[11px] text-[13px]">
          <span className="text-muted">{t("scan_detail.lblFeeLimit")}</span>
          <span className="font-mono font-semibold">{FEE_LIMIT_E7} EAV7</span>
        </div>

        {gasUsed != null && Number.isFinite(gasUsed) ? (
          <div className="border-t border-[var(--scan-border-soft)] py-[11px] text-[13px]">
            <div className="flex items-center justify-between">
              <span className="text-muted">{t("scan_detail.lblGasUsed")}</span>
              <span className="font-semibold tabular-nums">{num(gasUsed)}</span>
            </div>
            <ResourceBar pct={gasPct ?? 0} gradient="linear-gradient(90deg,#6336C4,#9F7BFF)" />
          </div>
        ) : null}
      </div>
    </Glass>
  );
}

/**
 * Tela de DETALHE DA TRANSAÇÃO.
 *
 * Recibo: só transação EAVM tem `receipt`. A AUSÊNCIA dele não é falha — é uma
 * transação nativa, que só entra no bloco se foi aplicada. Por isso `txOk()`
 * devolve `true` quando não há recibo, e nunca exibimos "falhou" por omissão.
 *
 * Validadores confirmantes: o nó não publica assinaturas por tx; listamos o set
 * ativo (ou um prefixo enquanto a tip ainda não finalizou o bloco).
 */
export function TxView({
  res,
  status,
  validators = [],
  t,
}: {
  res: TxDetail;
  status: Status | null;
  validators?: Validator[];
  t: T;
}) {
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

  const spot = getMarketPrice();
  const feeHuman = e7ToHuman(tx.fee);
  const feeUsd = feeHuman * spot.priceUsd;
  const gbBytes = estimateWeightedBytes(tx);
  // Com 2/3+1 do set ativo a tip já trata o bloco como finalizável; enquanto
  // não finalizou, mostramos um prefixo proporcional às confirmações.
  const confVals =
    validators.length === 0
      ? []
      : finalizado
        ? validators
        : validators.slice(0, Math.max(1, Math.min(validators.length, Math.ceil(validators.length * 2 / 3))));
  const confCount = confVals.length;
  return (
    <DetailPage>
      <BackLink href="/txs" label={t("scanLists.titleTxs")} />
      <h1 className="font-display mb-5 text-[26px] font-extrabold tracking-tight text-ink">
        {t("scan_detail.txTitle")}
      </h1>

      {/* Cartão de destaque — layout EAVScan.dc.html (2): status fixo à esquerda, fluxo centralizado. */}
      <div
        className="scan-glass flex items-center gap-[18px] px-7 py-[22px]"
        style={{
          background:
            "linear-gradient(135deg, color-mix(in srgb, var(--violet-deep) 16%, transparent), color-mix(in srgb, var(--violet-deep) 2%, transparent)), var(--scan-card)",
          borderColor: "color-mix(in srgb, var(--violet-deep) 35%, transparent)",
        }}
      >
        <span
          className={`grid size-[42px] shrink-0 place-items-center rounded-full text-[17px] font-bold ${
            ok ? "text-ok" : "text-red"
          }`}
          style={{ background: `color-mix(in srgb, var(--${ok ? "ok" : "red"}) 16%, transparent)` }}
          aria-hidden
        >
          {ok ? "✓" : "✕"}
        </span>

        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-[18px]">
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
            <TxBadge type={tx.type} />
          )}
        </div>
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

          {confCount > 0 ? (
            <KvRow label={t("scan_detail.confirmedValidators")}>
              <div>
                <div className="mb-2 font-bold text-ink">{num(confCount)}</div>
                <div className="flex flex-wrap gap-x-3.5 gap-y-1.5">
                  {confVals.map((v) => {
                    const label = v.name ? fmtNsName(v.name) || v.name : shortHash(v.address, 8, 5);
                    return (
                      <Link
                        key={v.address}
                        href={`/address/${v.address}`}
                        className="text-[12.5px] text-violet hover:underline"
                      >
                        {label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </KvRow>
          ) : null}

          <KvRow label={t("scan_detail.resourcesAndFee")}>
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinejoin="round" aria-hidden>
                  <path d="M12 2 2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
                <span className="tabular-nums font-semibold">{gbBytes.toLocaleString("pt-BR")} B</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
                </svg>
                <span className="font-bold text-[var(--red)]">{fmt(tx.fee)} EAV7</span>
              </span>
              <span className="text-[12px] text-faint">≈ {fmtUsd(feeUsd, feeUsd < 0.01 ? 6 : 4)}</span>
            </div>
          </KvRow>

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

          <KvRow label={t("scan_detail.lblNonce")}>
            <span className="tnum font-semibold">{num(tx.nonce)}</span>
          </KvRow>

          <KvRow label={t("scan_detail.lblScheme")}>
            <span className="font-mono">{tx.scheme ?? "eav7-hybrid-1"}</span>
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

      {/* Taxa e recursos — fiel a EAVScan.dc.html (barras GB / queima / gás). */}
      <FeeResources tx={tx} t={t} />

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
