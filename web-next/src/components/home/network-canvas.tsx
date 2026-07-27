"use client";

import { useEffect, useRef } from "react";

// Fundo animado: rede de nós (blockchain) conectados por linhas — brand roxo.
// Leve (canvas 2D, ~64 nós), DPR-aware, pausa se prefers-reduced-motion.
export function NetworkCanvas({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const cv = canvas;
    const ctx = context;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    const parent = cv.parentElement as HTMLElement;

    interface P {
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
    }
    let nodes: P[] = [];

    function seed() {
      const count = Math.min(96, Math.max(36, Math.floor((w * h) / 18000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.28,
        vy: (Math.random() - 0.5) * 0.28,
        r: Math.random() * 2 + 1,
      }));
    }

    function resize() {
      w = parent.clientWidth;
      h = parent.clientHeight;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = w * dpr;
      cv.height = h * dpr;
      cv.style.width = w + "px";
      cv.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    const DIST = 150;
    function draw() {
      ctx.clearRect(0, 0, w, h);
      // conexões
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < DIST) {
            const o = (1 - d / DIST) * 0.7;
            ctx.strokeStyle = `rgba(150,105,255,${o.toFixed(3)})`;
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      // nós
      for (const n of nodes) {
        ctx.fillStyle = "rgba(178,140,255,0.95)";
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    let raf = 0;
    let running = false;
    function step() {
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
      }
      draw();
      if (running) raf = requestAnimationFrame(step);
    }
    function start() {
      if (running || reduce) return;
      running = true;
      raf = requestAnimationFrame(step);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(raf);
    }

    resize();
    draw();

    // roda só quando o hero está visível (economiza CPU)
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) (e.isIntersecting ? start : stop)();
      },
      { threshold: 0 }
    );
    io.observe(parent);

    const ro = new ResizeObserver(resize);
    ro.observe(parent);

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden />;
}
