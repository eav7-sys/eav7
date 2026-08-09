"use client";

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

export function ListaShell({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="scan">
      <div className="mx-auto w-full max-w-[1280px] px-6 py-9">
        <h1 className="mb-5 text-[26px] font-extrabold tracking-[-0.01em] text-ink">{titulo}</h1>
        {children}
      </div>
    </div>
  );
}

/** O cartão de vidro que envolve a tabela. A rolagem horizontal fica AQUI
 *  dentro: sem isso a página inteira rola de lado no celular. */
export function Cartao({ children }: { children: React.ReactNode }) {
  return (
    <div className="scan-glass overflow-hidden">
      <div className="overflow-x-auto">{children}</div>
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
 *  no mesmo tom, o que ajuda a reconhecer repetições ao correr o olho. */
export function corDe(semente: string): string {
  let h = 0;
  for (let i = 0; i < semente.length; i++) h = (h * 31 + semente.charCodeAt(i)) % 360;
  return `hsl(${h} 62% 58%)`;
}
