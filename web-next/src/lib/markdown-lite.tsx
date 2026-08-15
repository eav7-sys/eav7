import type { ReactNode } from "react";

/** Minimal Markdown → React for whitepaper (headings, lists, tables, quotes, inline). */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // links, bold, code — left-to-right
  const re = /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      const href = m[3];
      const external = /^https?:\/\//i.test(href);
      out.push(
        <a
          key={key++}
          href={href}
          className="text-teal underline decoration-teal/40 underline-offset-2 hover:decoration-teal"
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {m[2]}
        </a>,
      );
    } else if (m[4]) {
      out.push(
        <strong key={key++} className="font-semibold text-ink">
          {m[5]}
        </strong>,
      );
    } else if (m[6]) {
      out.push(
        <code
          key={key++}
          className="rounded bg-[var(--input-bg)] px-1.5 py-0.5 font-mono text-[12.5px] text-violet"
        >
          {m[7]}
        </code>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function MarkdownLite({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={k++} className="my-8 border-line" />);
      i++;
      continue;
    }

    const h = /^(#{1,4})\s+(.+)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      const id = slugify(text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"));
      const cls =
        level === 1
          ? "font-display mt-2 text-[clamp(26px,4vw,36px)] font-extrabold leading-tight tracking-tight text-ink"
          : level === 2
            ? "font-display mt-10 scroll-mt-24 text-[22px] font-bold text-ink"
            : level === 3
              ? "font-display mt-7 scroll-mt-24 text-[17px] font-semibold text-ink"
              : "mt-5 scroll-mt-24 text-[15px] font-semibold text-ink";
      const kids = inline(text);
      if (level === 1) blocks.push(<h1 key={k++} id={id} className={cls}>{kids}</h1>);
      else if (level === 2) blocks.push(<h2 key={k++} id={id} className={cls}>{kids}</h2>);
      else if (level === 3) blocks.push(<h3 key={k++} id={id} className={cls}>{kids}</h3>);
      else blocks.push(<h4 key={k++} id={id} className={cls}>{kids}</h4>);
      i++;
      continue;
    }

    if (line.trimStart().startsWith("> ")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith("> ")) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote
          key={k++}
          className="my-5 rounded-xl border border-line border-l-[3px] border-l-teal/70 bg-[var(--input-bg)] px-4 py-3 text-[13.5px] leading-relaxed text-muted"
        >
          {inline(quote.join(" "))}
        </blockquote>,
      );
      continue;
    }

    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const raw = lines[i].trim();
        i++;
        if (/^\|[\s-:|]+\|$/.test(raw)) continue;
        rows.push(
          raw
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((c) => c.trim()),
        );
      }
      if (rows.length) {
        const [head, ...body] = rows;
        blocks.push(
          <div key={k++} className="my-5 overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead className="border-b border-line bg-[var(--input-bg)] font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
                <tr>
                  {head.map((c, j) => (
                    <th key={j} className="px-3 py-2.5 font-medium">
                      {inline(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {body.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((c, j) => (
                      <td key={j} className="px-3 py-2.5 align-top text-muted">
                        {inline(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
      }
      continue;
    }

    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const ordered = /^\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i];
        if (ordered ? !/^\d+\.\s+/.test(cur) : !/^[-*]\s+/.test(cur)) break;
        items.push(cur.replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, ""));
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag
          key={k++}
          className={`my-4 space-y-1.5 pl-5 text-[14px] leading-relaxed text-muted ${
            ordered ? "list-decimal" : "list-disc"
          }`}
        >
          {items.map((item, j) => (
            <li key={j}>{inline(item)}</li>
          ))}
        </Tag>,
      );
      continue;
    }

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      i++;
      const code: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push(
        <pre
          key={k++}
          className="my-5 overflow-x-auto rounded-xl border border-line bg-[var(--input-bg)] p-4 font-mono text-[12px] leading-relaxed text-ink"
          data-lang={lang || undefined}
        >
          {code.join("\n")}
        </pre>,
      );
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|---|```|> |\||[-*]\s|\d+\.\s)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={k++} className="my-3 text-[14.5px] leading-[1.75] text-muted">
        {inline(para.join(" "))}
      </p>,
    );
  }

  return <div className="wp-md min-w-0">{blocks}</div>;
}
