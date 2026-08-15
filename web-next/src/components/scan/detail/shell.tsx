import Link from "next/link";
import type { ReactNode } from "react";
import { Copy } from "@/components/ui/copy";
import { ExplorerSearch } from "@/components/ui/explorer-search";
import { avatarTone, initials } from "@/components/scan/identity";
import { fmt, fmtToken, shortHash } from "@/lib/format";
import type { Tx } from "@/lib/api";
import "../tokens.css";
import "./detail.css";

/** Assinatura do tradutor — as telas são Server Components e recebem `t` por prop. */
export type T = (k: string, v?: Record<string, string | number>) => string;

// Reexporta a identidade visual canônica para os call sites históricos `./shell`.
export { avatarTone, initials };

/** Cor estável derivada de um texto: o mesmo endereço recebe sempre o mesmo tom. */
export const avatarBg = avatarTone;

/** Moldura das quatro telas: fundo com brilho, largura máxima e respiro. */
export function DetailPage({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return (
    <div className="scan">
      <div style={{ background: "var(--scan-glow)" }}>
        <div className={`mx-auto w-full px-6 py-9 ${wide ? "max-w-[1280px]" : "max-w-[1080px]"}`}>{children}</div>
      </div>
    </div>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mb-3.5 inline-block text-[13px] font-semibold text-violet hover:underline">
      ← {label}
    </Link>
  );
}

export function Glass({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`scan-glass ${className}`}>{children}</div>;
}

/** Lista rótulo → valor. `<dl>` porque é literalmente isso: termos e definições. */
export function Kv({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <dl className={`px-6 py-0.5 ${className}`}>{children}</dl>;
}

export function KvRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="scan-kv">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Linha simples rótulo à esquerda / valor à direita (cartões laterais do desenho). */
export function SideRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-[var(--scan-border-soft)] py-3 text-[13px] first:border-t-0">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 text-right font-semibold text-ink">{children}</span>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="font-display mb-3.5 mt-7 text-[16px] font-bold text-ink">{children}</h2>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-5 py-14 text-center text-[12.5px] text-faint">{children}</div>;
}

export function EmptyRow({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tr className="hover:!bg-transparent">
      <td colSpan={cols} className="py-14 text-center text-[12.5px] text-faint">
        {children}
      </td>
    </tr>
  );
}

/** Hash monoespaçado que trunca com reticências e leva o valor inteiro no title. */
export function Mono({ text, head = 20, tail = 12 }: { text: string; head?: number; tail?: number }) {
  return (
    <span className="font-mono truncate" title={text}>
      {shortHash(text, head, tail)}
    </span>
  );
}

/** Hash + botão de copiar — o par que aparece em toda linha de identificação. */
export function HashWithCopy({ text, head = 24, tail = 16 }: { text: string; head?: number; tail?: number }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Mono text={text} head={head} tail={tail} />
      <Copy text={text} icon />
    </span>
  );
}

/** Ponto colorido derivado do endereço, do tamanho pedido. */
export function Dot({ seed, size = 18, radius = 6 }: { seed: string; size?: number; radius?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0"
      style={{ width: size, height: size, borderRadius: radius, background: avatarBg(seed) }}
    />
  );
}

/**
 * Resultado da execução. AUSÊNCIA de recibo significa transação NÃO-EAVM, que por
 * definição só entra no bloco se aplicou — logo, sucesso. Nunca "falhou" por omissão.
 */
export const txOk = (tx: Pick<Tx, "receipt">) => (tx.receipt ? tx.receipt.success : true);

/**
 * Destino EFETIVO da transação. Numa chamada EAVM o alvo é o CONTRATO, que viaja
 * em `data.to` e não no campo `to` do protocolo — sem isto o destino apareceria
 * vazio justamente nas transações de contrato, que é onde ele mais importa.
 */
export function destOf(tx: Pick<Tx, "to" | "data">): string | null {
  if (tx.to) return tx.to;
  const d = tx.data?.to;
  return typeof d === "string" ? d : null;
}

export function ResultBadge({ ok, t }: { ok: boolean; t: T }) {
  return (
    <span className={`badge ${ok ? "badge-green" : "badge-red"}`}>
      {ok ? "✓" : "✕"} {ok ? t("scan_detail.resultOk") : t("scan_detail.resultFail")}
    </span>
  );
}

/**
 * Valor movido pela transação, na unidade CERTA: EAV7 tem 6 casas, um token EAV20
 * tem as dele, e um EAV721 não tem valor — tem número de série.
 */
export function Amount({ tx }: { tx: Tx }) {
  if (tx.asset?.kind === "EAV721") {
    return <span className="tnum">#{tx.asset.tokenId ?? "—"}</span>;
  }
  if (tx.asset?.kind === "EAV20") {
    return (
      <span className="tnum whitespace-nowrap">
        {fmtToken(tx.amount, tx.asset.decimals ?? 0)}{" "}
        <span className="text-muted">{tx.asset.symbol ?? "EAV20"}</span>
      </span>
    );
  }
  if (!tx.amount || tx.amount === "0") return <span className="text-faint">—</span>;
  return (
    <span className="tnum whitespace-nowrap">
      {fmt(tx.amount)} <span className="text-muted">EAV7</span>
    </span>
  );
}

/** Painel de uma aba. `tabIndex={-1}` permite levar o foco ao conteúdo trocado. */
export function TabPanel({ id, labelledBy, children }: { id: string; labelledBy: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={id} aria-labelledby={labelledBy} tabIndex={-1} className="scan-in mt-5">
      {children}
    </div>
  );
}

/**
 * Tela de "não encontrado". Um hash colado errado é o erro mais comum num
 * explorador — merece uma tela que diz O QUE não existe e devolve a busca, não um
 * 404 genérico nem uma página em branco.
 */
export function NotFoundView({
  title,
  query,
  hint,
  t,
}: {
  title: string;
  query: string;
  hint: string;
  t: T;
}) {
  return (
    <DetailPage>
      <Glass className="px-7 py-12 text-center">
        <div className="font-display text-[22px] font-extrabold text-ink">{title}</div>
        <p className="mx-auto mt-2 max-w-[52ch] text-[13px] leading-relaxed text-muted">{hint}</p>
        <p className="font-mono mt-4 break-all text-[12px] text-faint">{query}</p>
        <div className="mx-auto mt-7 max-w-[560px]">
          <ExplorerSearch placeholder={t("scan_detail.nfSearchPh")} buttonLabel={t("scan_detail.nfSearchBtn")} />
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-2 text-[12.5px]">
          {[
            { href: "/blocks", label: t("scan_detail.nfBlocks") },
            { href: "/txs", label: t("scan_detail.nfTxs") },
            { href: "/", label: t("scan_detail.nfHome") },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-lg border border-[var(--scan-border)] px-3.5 py-1.5 font-semibold text-violet hover:bg-[var(--scan-hover)]"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </Glass>
    </DetailPage>
  );
}
