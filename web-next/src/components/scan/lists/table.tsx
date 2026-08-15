"use client";

import { avatarTone } from "../identity";
import "../tokens.css";

/**
 * Peças comuns às quatro telas de listagem do desenho EAVScan (blocos,
 * transações, tokens e validadores).
 *
 * O desenho monta cada linha com `display:grid`. Aqui usamos `<table>` de
 * verdade: leitor de tela precisa do par célula↔cabeçalho para dizer "Produtor:
 * E7A4…" em vez de ler sete valores soltos. As larguras do desenho viram
 * `<colgroup>`, que dá o mesmo controle sem perder a semântica.
 */

/**
 * Cabeçalho padrão das telas do explorer: selo (eyebrow) + título + subtítulo.
 * Extraído do ListaShell para que páginas fora das listas (/ai, /governance,
 * /mining, /nfts, /names) tenham EXATAMENTE o mesmo bloco — antes cada uma
 * montava a sua variação e elas divergiam em tamanho, cor e respiro.
 *
 * `subtitle` é ReactNode (não string) para comportar linhas extras, como a
 * spec-line monoespaçada da /ai. Por isso o invólucro é <div>, não <p>:
 * aninhar bloco em <p> é HTML inválido.
 */
export function ScanPageHeader({
  titulo,
  eyebrow,
  subtitle,
  live = false,
  titleExtra,
}: {
  titulo: React.ReactNode;
  eyebrow?: string;
  subtitle?: React.ReactNode;
  live?: boolean;
  /** Elemento ao lado do título (ex.: selo "ao vivo" da /mining). */
  titleExtra?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      {eyebrow ? (
        <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(159,123,255,0.35)] bg-[var(--scan-chip)] px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--scan-link)]">
          {live ? <span className="scan-live" aria-hidden /> : null}
          {eyebrow}
        </div>
      ) : null}
      <h1
        className={`font-display font-bold tracking-[-0.02em] text-ink ${
          eyebrow
            ? "mt-3.5 text-[clamp(30px,3.4vw,40px)]"
            : "mb-0 text-[26px] font-extrabold tracking-[-0.01em]"
        }`}
      >
        {titulo}
        {titleExtra}
      </h1>
      {subtitle ? (
        <div className="mt-2.5 max-w-[720px] text-[13.5px] leading-relaxed text-muted">{subtitle}</div>
      ) : null}
    </div>
  );
}

export function ListaShell({
  titulo,
  eyebrow,
  subtitle,
  live = false,
  titleExtra,
  children,
}: {
  titulo: React.ReactNode;
  eyebrow?: string;
  subtitle?: React.ReactNode;
  live?: boolean;
  titleExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="scan">
      <div className="mx-auto w-full max-w-[1280px] px-6 py-9">
        <ScanPageHeader titulo={titulo} eyebrow={eyebrow} subtitle={subtitle} live={live} titleExtra={titleExtra} />
        {children}
      </div>
    </div>
  );
}

/** Cartão de métrica — mesmo padrão da página /ai. */
export function StatCard({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="scan-glass px-[18px] py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">{label}</div>
      <div className="mt-[7px] font-display text-xl font-bold text-ink">{value}</div>
    </div>
  );
}

/** O cartão de vidro que envolve a tabela. A rolagem horizontal fica AQUI
 *  dentro: sem isso a página inteira rola de lado no celular. `scan-scroll-x`
 *  (tokens.css) desenha a sombra de "há mais conteúdo" nas bordas. */
export function Cartao({ children }: { children: React.ReactNode }) {
  return (
    <div className="scan-glass overflow-hidden">
      <div className="scan-scroll-x">{children}</div>
    </div>
  );
}

export function Th({
  children,
  right = false,
  className = "",
}: {
  children: React.ReactNode;
  right?: boolean;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint ${
        right ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
    </th>
  );
}

/** Linha da tabela com o hover do desenho. */
export function Tr({ children }: { children: React.ReactNode }) {
  return (
    <tr className="border-t border-[var(--scan-border-soft)] hover:bg-[var(--scan-hover)]">
      {children}
    </tr>
  );
}

export function Td({
  children,
  right = false,
  className = "",
}: {
  children: React.ReactNode;
  right?: boolean;
  className?: string;
}) {
  return (
    <td className={`px-5 py-[13px] text-[13px] ${right ? "text-right" : ""} ${className}`}>
      {children}
    </td>
  );
}

/**
 * Estado vazio. Obrigatório: a cadeia de testes tem poucas transações e contas,
 * então tabela vazia é o caso NORMAL — sem uma frase, parece defeito.
 */
export function Vazio({ colunas, msg }: { colunas: number; msg: string }) {
  return (
    <tr className="border-t border-[var(--scan-border-soft)]">
      <td colSpan={colunas} className="px-5 py-14 text-center text-[13px] text-muted">
        {msg}
      </td>
    </tr>
  );
}

export function Paginacao({
  rotulo,
  anterior,
  proxima,
  rotuloAnterior,
  rotuloProxima,
}: {
  rotulo: React.ReactNode;
  anterior: (() => void) | null;
  proxima: (() => void) | null;
  rotuloAnterior: string;
  rotuloProxima: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-[var(--scan-border-soft)] px-5 py-3.5 text-[12.5px] text-muted">
      <div>{rotulo}</div>
      <div className="flex gap-2">
        <BotaoPagina onClick={anterior}>← {rotuloAnterior}</BotaoPagina>
        <BotaoPagina onClick={proxima}>{rotuloProxima} →</BotaoPagina>
      </div>
    </div>
  );
}

function BotaoPagina({
  onClick,
  children,
}: {
  onClick: (() => void) | null;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick ?? undefined}
      disabled={!onClick}
      className="rounded-lg border border-[var(--scan-border)] px-3.5 py-1.5 font-semibold text-ink transition hover:bg-[var(--scan-hover)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/** Selo colorido (status de tx, saúde de validador). */
export function Selo({
  tom,
  children,
}: {
  tom: "ok" | "erro" | "aviso" | "violeta";
  children: React.ReactNode;
}) {
  const cor = {
    ok: "var(--ok)",
    erro: "var(--red)",
    aviso: "var(--gold)",
    violeta: "var(--violet)",
  }[tom];
  return (
    <span
      className="inline-block whitespace-nowrap rounded-md px-2 py-[3px] text-[10.5px] font-semibold"
      style={{ color: cor, background: `color-mix(in srgb, ${cor} 14%, transparent)` }}
    >
      {children}
    </span>
  );
}

/** Avatar de cor estável derivada da semente — o mesmo endereço/token sempre
 *  no mesmo tom, o que ajuda a reconhecer repetições ao correr o olho.
 *  Reexporta a identidade canônica (`scan/identity`) para os call sites `./table`. */
export const corDe = avatarTone;
