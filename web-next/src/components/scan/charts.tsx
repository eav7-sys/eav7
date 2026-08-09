"use client";

import { useT } from "@/i18n/provider";
import { numCompact } from "@/lib/format";

/**
 * Os dois gráficos da home.
 *
 * O desenho trazia TRANSAÇÕES e PREÇO. O de preço saiu junto com o card de
 * preço, pelo mesmo motivo — não há série de preço que não seja inventada. No
 * lugar entra BLOCOS POR HORA, que é dado real e diz sobre a rede o que o de
 * preço diria sobre o mercado: se ela está saudável.
 *
 * SVG puro, sem biblioteca de gráficos: são barras e uma linha, e um pacote a
 * mais no bundle do navegador se paga em nada aqui.
 */

function Moldura({ title, right, children }: { title: string; right: string; children: React.ReactNode }) {
  return (
    <div className="scan-glass p-5">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-bold text-ink">{title}</div>
        <div className="text-[11.5px] text-faint">{right}</div>
      </div>
      {children}
    </div>
  );
}

function SemDados({ msg }: { msg: string }) {
  return <div className="flex h-[150px] items-center justify-center text-[13px] text-faint">{msg}</div>;
}

/** Barras — uma por balde horário. */
export function TxChart({ series }: { series: number[] }) {
  const t = useT();
  const total = series.reduce((a, b) => a + b, 0);
  if (!series.length || total === 0) {
    return (
      <Moldura title={t("scan.chartTx")} right={t("scan.chartWindow")}>
        <SemDados msg={t("scan.empty")} />
      </Moldura>
    );
  }

  const max = Math.max(...series);
  const larguraBarra = 600 / series.length;
  const vao = Math.min(4, larguraBarra * 0.25);

  return (
    <Moldura title={t("scan.chartTx")} right={`${t("scan.chartWindow")} · ${numCompact(total)}`}>
      <svg viewBox="0 0 600 160" preserveAspectRatio="none" className="mt-3.5 block h-[150px] w-full" role="img"
           aria-label={`${t("scan.chartTx")}: ${numCompact(total)}`}>
        {series.map((v, i) => {
          // Altura mínima de 2px para um balde com valor > 0 não sumir: uma barra
          // invisível e um zero contam a mesma história, e não são a mesma coisa.
          const h = v === 0 ? 0 : Math.max(2, (v / max) * 148);
          return (
            <rect key={i} x={i * larguraBarra + vao / 2} y={156 - h} width={larguraBarra - vao} height={h}
                  rx="3" fill="var(--violet-deep)" opacity="0.8" />
          );
        })}
      </svg>
    </Moldura>
  );
}

/** Linha com área — blocos produzidos por hora. */
export function BlocksChart({ series }: { series: number[] }) {
  const t = useT();
  // Vinte e quatro zeros TÊM comprimento — e desenhariam uma linha reta no chão,
  // que se lê como "a rede parou" em vez de "não há dado nesta janela". A cadeia
  // de teste, com blocos de dias atrás, cai exatamente aqui.
  const total = series.reduce((a, b) => a + b, 0);
  if (series.length < 2 || total === 0) {
    return (
      <Moldura title={t("scan.chartBlocks")} right={t("scan.chartWindow")}>
        <SemDados msg={t("scan.empty")} />
      </Moldura>
    );
  }

  const max = Math.max(...series, 1);
  const passo = 600 / (series.length - 1);
  const pontos = series.map((v, i) => [i * passo, 152 - (v / max) * 140] as const);
  const linha = pontos.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${linha} L600,160 L0,160 Z`;
  const ultima = series[series.length - 1] ?? 0;

  return (
    <Moldura title={t("scan.chartBlocks")} right={`${t("scan.chartWindow")} · ${numCompact(ultima)}/h`}>
      <svg viewBox="0 0 600 160" preserveAspectRatio="none" className="mt-3.5 block h-[150px] w-full" role="img"
           aria-label={t("scan.chartBlocks")}>
        <defs>
          <linearGradient id="scanBlocksGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--violet-deep)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--violet-deep)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#scanBlocksGrad)" />
        <path d={linha} fill="none" stroke="var(--violet)" strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
    </Moldura>
  );
}
