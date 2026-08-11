import { Copy } from "@/components/ui/copy";

export interface CodeSample {
  /** rótulo já traduzido — costuma ser a linguagem ou o alvo (`curl`, `Rust`) */
  label: string;
  code: string;
}

export function TerminalDots() {
  return (
    <span className="flex items-center gap-1.5" aria-hidden>
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
    </span>
  );
}

/** Bloco de código com a moldura de terminal do explorador (sempre escuro). */
export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="code-term overflow-hidden rounded-xl">
      <div className="code-term-bar flex items-center justify-between gap-3 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <TerminalDots />
          {label && (
            <span className="font-mono truncate text-[10.5px] uppercase tracking-[1px]">{label}</span>
          )}
        </div>
        <Copy text={code} icon />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed">{code}</pre>
    </div>
  );
}
