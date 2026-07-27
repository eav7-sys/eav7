"use client";

import { useEffect, useRef, useState } from "react";

// Número que faz "count-up" suave sempre que o valor muda (dá vida aos dados ao vivo).
// Não anima na montagem para não quebrar a hidratação — só nas atualizações.
export function AnimatedNumber({
  value,
  format = (n: number) => n.toLocaleString("pt-BR"),
}: {
  value: number;
  format?: (n: number) => string;
}) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    const from = prev.current;
    const to = value;
    prev.current = value;
    if (from === to) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dur = reduce ? 0 : 600;
    let raf = 0;
    let startTs = 0;
    const step = (ts: number) => {
      if (!startTs) startTs = ts;
      const p = dur === 0 ? 1 : Math.min(1, (ts - startTs) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span suppressHydrationWarning>{format(display)}</span>;
}
