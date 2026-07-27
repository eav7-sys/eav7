"use client";

import { useEffect, useState } from "react";
import { ago } from "@/lib/format";

// Tempo relativo que atualiza sozinho e não quebra a hidratação
// (o valor server/client difere por segundos — suprimimos o warning e re-render no client).
export function Ago({ ts }: { ts: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);
  return <span suppressHydrationWarning>{ago(ts)}</span>;
}
