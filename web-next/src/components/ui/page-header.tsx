import { Copy } from "./copy";

interface PageHeaderProps {
  title: React.ReactNode;
  sub?: React.ReactNode;
  copySub?: string;
  eyebrow?: string;
  /** Selos de identidade exibidos ao lado do título (ex.: Validador, taxa zero). */
  badges?: React.ReactNode;
  /** Conteúdo alinhado à direita, na mesma linha do subtítulo (ex.: datas de atividade). */
  aside?: React.ReactNode;
}

export function PageHeader({ title, sub, copySub, eyebrow, badges, aside }: PageHeaderProps) {
  return (
    <div className="rise mb-6">
      {eyebrow && (
        <div className="font-mono text-[11px] font-semibold uppercase tracking-[2px] text-teal">
          {eyebrow}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-display text-[clamp(22px,3.4vw,32px)] font-extrabold leading-tight tracking-tight">
          {title}
        </h1>
        {badges && <span className="flex flex-wrap items-center gap-2 text-[12px]">{badges}</span>}
      </div>
      {(sub || aside) && (
        <div className="mt-1.5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          {sub && (
            <div className="flex items-center gap-2 break-all font-mono text-[12.5px] text-muted">
              <span>{sub}</span>
              {copySub && <Copy text={copySub} />}
            </div>
          )}
          {aside && <div className="ml-auto">{aside}</div>}
        </div>
      )}
    </div>
  );
}
