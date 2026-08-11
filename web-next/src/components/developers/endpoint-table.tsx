export interface EndpointRow {
  method: "GET" | "POST";
  path: string;
  desc: string;
}

export interface EndpointSection {
  title: string;
  rows: EndpointRow[];
}

function MethodTag({ method }: { method: EndpointRow["method"] }) {
  return (
    <span
      className={`font-mono inline-block w-[42px] rounded-md py-0.5 text-center text-[10px] font-bold ${
        method === "GET" ? "bg-ok/15 text-ok" : "bg-gold/15 text-gold"
      }`}
    >
      {method}
    </span>
  );
}

/**
 * Tabela de endpoints agrupada. Puro HTML de servidor: são dezenas de linhas e
 * nenhuma delas precisa de JavaScript no cliente para ser lida.
 */
export function EndpointTable({
  sections,
  columns,
}: {
  sections: EndpointSection[];
  columns: { method: string; path: string; desc: string };
}) {
  return (
    <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[600px] border-collapse text-left">
        <thead>
          <tr>
            <th className="font-mono w-[58px] border-b border-line-2 pb-2.5 text-[10px] font-semibold uppercase tracking-[1.2px] text-faint">
              {columns.method}
            </th>
            <th className="font-mono border-b border-line-2 pb-2.5 text-[10px] font-semibold uppercase tracking-[1.2px] text-faint">
              {columns.path}
            </th>
            <th className="font-mono border-b border-line-2 pb-2.5 text-[10px] font-semibold uppercase tracking-[1.2px] text-faint">
              {columns.desc}
            </th>
          </tr>
        </thead>
        {sections.map((section) => (
          <tbody key={section.title}>
            <tr>
              <th
                colSpan={3}
                className="font-mono pb-1.5 pt-6 text-left text-[10px] font-semibold uppercase tracking-[1.6px] text-violet"
              >
                {section.title}
              </th>
            </tr>
            {section.rows.map((row) => (
              <tr key={row.path} className="border-b border-line/50 transition-colors hover:bg-violet/[0.04]">
                <td className="py-2.5 align-top">
                  <MethodTag method={row.method} />
                </td>
                <td className="py-2.5 pr-5 align-top">
                  <code className="font-mono whitespace-nowrap text-[12.5px] font-semibold text-ink">
                    {row.path}
                  </code>
                </td>
                <td className="py-2.5 align-top text-[13px] leading-relaxed text-muted">{row.desc}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
