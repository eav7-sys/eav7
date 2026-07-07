import { useEffect, useRef, useState } from 'react';

// Busca dados e repete no intervalo dado (0 = uma vez). Retorna dado/erro/loading.
export function usePolling<T>(fn: () => Promise<T>, intervalMs = 0, deps: unknown[] = []): {
  data: T | null;
  error: string | null;
  loading: boolean;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const d = await fnRef.current();
        if (alive) { setData(d); setError(null); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
        if (alive && intervalMs > 0) timer = setTimeout(tick, intervalMs);
      }
    };
    setLoading(true);
    tick();
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading };
}
