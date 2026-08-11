"use client";

import { cn } from "@/lib/utils";
import React, { useEffect, useRef } from "react";
import { createNoise3D } from "simplex-noise";

interface VortexProps {
  children?: React.ReactNode;
  className?: string;
  containerClassName?: string;
  particleCount?: number;
  rangeY?: number;
  baseHue?: number;
  baseSpeed?: number;
  rangeSpeed?: number;
  baseRadius?: number;
  rangeRadius?: number;
  /** cor de fundo; use "transparent" para deixar o fundo do site aparecer */
  backgroundColor?: string;
}

export function Vortex(props: VortexProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameId = useRef<number>(0);

  const particleCount = props.particleCount || 640;
  const particlePropCount = 9;
  const particlePropsLength = particleCount * particlePropCount;
  const rangeY = props.rangeY || 100;
  const baseTTL = 50;
  const rangeTTL = 150;
  const baseSpeed = props.baseSpeed || 0.0;
  const rangeSpeed = props.rangeSpeed || 1.5;
  const baseRadius = props.baseRadius || 1;
  const rangeRadius = props.rangeRadius || 2;
  const baseHue = props.baseHue ?? 260; // violeta da marca
  const rangeHue = 90;
  const noiseSteps = 3;
  const xOff = 0.00125;
  const yOff = 0.00125;
  const zOff = 0.0005;
  const backgroundColor = props.backgroundColor || "transparent";

  const TAU = 2 * Math.PI;
  const rand = (n: number) => n * Math.random();
  const randRange = (n: number) => n - rand(2 * n);
  const fadeInOut = (t: number, m: number) => {
    const hm = 0.5 * m;
    return Math.abs(((t + hm) % m) - hm) / hm;
  };
  const lerp = (n1: number, n2: number, speed: number) => (1 - speed) * n1 + speed * n2;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const noise3D = createNoise3D();
    const particleProps = new Float32Array(particlePropsLength);
    const center: [number, number] = [0, 0];
    let tick = 0;
    let running = true;
    let isLight = false; // atualizado por frame — partículas escuras no tema claro

    function resize() {
      if (!canvas || !ctx) return;
      const { innerWidth, innerHeight } = window;
      canvas.width = innerWidth;
      canvas.height = innerHeight;
      center[0] = 0.5 * canvas.width;
      center[1] = 0.5 * canvas.height;
    }

    function initParticle(i: number) {
      if (!canvas) return;
      const x = rand(canvas.width);
      const y = center[1] + randRange(rangeY);
      const vx = 0;
      const vy = 0;
      const life = 0;
      const ttl = baseTTL + rand(rangeTTL);
      const speed = baseSpeed + rand(rangeSpeed);
      const radius = baseRadius + rand(rangeRadius);
      const hue = baseHue + rand(rangeHue);
      particleProps.set([x, y, vx, vy, life, ttl, speed, radius, hue], i);
    }

    function initParticles() {
      tick = 0;
      for (let i = 0; i < particlePropsLength; i += particlePropCount) initParticle(i);
    }

    function checkBounds(x: number, y: number) {
      if (!canvas) return true;
      return x > canvas.width || x < 0 || y > canvas.height || y < 0;
    }

    function drawParticle(
      x: number,
      y: number,
      x2: number,
      y2: number,
      life: number,
      ttl: number,
      radius: number,
      hue: number
    ) {
      if (!ctx) return;
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineWidth = radius;
      const sat = isLight ? 85 : 85;
      const lig = isLight ? 42 : 66;
      const a = fadeInOut(life, ttl) * (isLight ? 1 : 1);
      ctx.strokeStyle = `hsla(${hue},${sat}%,${lig}%,${a})`;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.closePath();
      ctx.restore();
    }

    function updateParticle(i: number) {
      if (!canvas) return;
      const i2 = 1 + i,
        i3 = 2 + i,
        i4 = 3 + i,
        i5 = 4 + i,
        i6 = 5 + i,
        i7 = 6 + i,
        i8 = 7 + i,
        i9 = 8 + i;

      const x = particleProps[i];
      const y = particleProps[i2];
      const n = noise3D(x * xOff, y * yOff, tick * zOff) * noiseSteps * TAU;
      const vx = lerp(particleProps[i3], Math.cos(n), 0.5);
      const vy = lerp(particleProps[i4], Math.sin(n), 0.5);
      let life = particleProps[i5];
      const ttl = particleProps[i6];
      const speed = particleProps[i7];
      const x2 = x + vx * speed;
      const y2 = y + vy * speed;
      const radius = particleProps[i8];
      const hue = particleProps[i9];

      drawParticle(x, y, x2, y2, life, ttl, radius, hue);
      life++;

      particleProps[i] = x2;
      particleProps[i2] = y2;
      particleProps[i3] = vx;
      particleProps[i4] = vy;
      particleProps[i5] = life;

      if (checkBounds(x, y) || life > ttl) initParticle(i);
    }

    function drawParticles() {
      for (let i = 0; i < particlePropsLength; i += particlePropCount) updateParticle(i);
    }

    function renderGlow() {
      if (!canvas || !ctx) return;
      // no tema claro, partículas cruas e nítidas (glow "lighter" clarearia e sumiria).
      if (isLight) {
        ctx.save();
        ctx.filter = "blur(1.5px)";
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 0.5;
        ctx.drawImage(canvas, 0, 0);
        ctx.restore();
        return;
      }
      ctx.save();
      ctx.filter = "blur(8px) brightness(200%)";
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(canvas, 0, 0);
      ctx.restore();

      ctx.save();
      ctx.filter = "blur(4px) brightness(200%)";
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(canvas, 0, 0);
      ctx.restore();
    }

    function draw() {
      if (!canvas || !ctx || !running) return;
      tick++;
      isLight = document.documentElement.getAttribute("data-theme") === "light";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (backgroundColor !== "transparent") {
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      drawParticles();
      renderGlow();
      animationFrameId.current = window.requestAnimationFrame(draw);
    }

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resize();
    initParticles();
    if (!reduce) draw();
    else {
      // um quadro estático
      drawParticles();
      renderGlow();
    }

    window.addEventListener("resize", resize);
    return () => {
      running = false;
      window.cancelAnimationFrame(animationFrameId.current);
      window.removeEventListener("resize", resize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={cn("relative h-full w-full", props.containerClassName)} ref={containerRef}>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      <div className={cn("relative z-10", props.className)}>{props.children}</div>
    </div>
  );
}
