"use client";

/**
 * Baixa em CSV exatamente as linhas que estão na tela.
 *
 * Gera o arquivo no cliente a partir dos dados JÁ recebidos — não há uma segunda
 * consulta nem qualquer coluna calculada: o que se exporta é o que se vê.
 */
export function CsvButton({
  headers,
  rows,
  filename,
  label,
}: {
  headers: string[];
  rows: (string | number)[][];
  filename: string;
  label: string;
}) {
  function baixar() {
    // Aspas + prefixo anti-fórmula: símbolos on-chain podem começar com =+-@ e o
    // Excel executaria a célula no import.
    const escapa = (v: string | number) => {
      let s = String(v).replaceAll('"', '""');
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return `"${s}"`;
    };
    const csv = [headers, ...rows].map((r) => r.map(escapa).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={baixar}
      disabled={rows.length === 0}
      className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-violet hover:underline disabled:cursor-not-allowed disabled:text-faint disabled:no-underline"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="m7 10 5 5 5-5" />
        <path d="M12 15V3" />
      </svg>
      {label}
    </button>
  );
}
