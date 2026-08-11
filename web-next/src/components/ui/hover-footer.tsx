"use client";

import React, { useRef, useState, useEffect } from "react";
import { motion } from "framer-motion";

// Texto gigante com revelação de gradiente seguindo o cursor (adaptado do nurui/aceternity).
export function TextHoverEffect({
  text,
  duration = 0,
  className,
}: {
  text: string;
  duration?: number;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);
  const [maskPosition, setMaskPosition] = useState({ cx: "50%", cy: "50%" });

  useEffect(() => {
    if (svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      const cx = ((cursor.x - rect.left) / rect.width) * 100;
      const cy = ((cursor.y - rect.top) / rect.height) * 100;
      setMaskPosition({ cx: `${cx}%`, cy: `${cy}%` });
    }
  }, [cursor]);

  const textCls = "font-display fill-transparent text-[64px] font-extrabold";

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      viewBox="0 0 320 100"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseMove={(e) => setCursor({ x: e.clientX, y: e.clientY })}
      className={`select-none ${className ?? ""}`}
    >
      <defs>
        <linearGradient id="eav7-text-grad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="320" y2="0">
          <stop offset="0%" stopColor="#9a6cff" />
          <stop offset="35%" stopColor="#7a5cf0" />
          <stop offset="65%" stopColor="#45e0e6" />
          <stop offset="100%" stopColor="#5ea0ff" />
        </linearGradient>

        {/* holofote: segue o cursor no hover, varre sozinho quando ocioso */}
        <motion.radialGradient
          id="eav7-reveal-mask"
          gradientUnits="userSpaceOnUse"
          r={hovered ? "28%" : "30%"}
          initial={{ cx: "50%", cy: "50%" }}
          animate={
            hovered
              ? { cx: maskPosition.cx, cy: maskPosition.cy }
              : { cx: ["12%", "88%", "12%"], cy: ["44%", "56%", "44%"] }
          }
          transition={
            hovered
              ? { duration, ease: "easeOut" }
              : { duration: 5.5, ease: "easeInOut", repeat: Infinity }
          }
        >
          <stop offset="0%" stopColor="white" />
          <stop offset="100%" stopColor="black" />
        </motion.radialGradient>

        <mask id="eav7-text-mask">
          <rect x="0" y="0" width="100%" height="100%" fill="url(#eav7-reveal-mask)" />
        </mask>
      </defs>

      {/* contorno sempre visível */}
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" strokeWidth="0.4" className={textCls} style={{ stroke: "color-mix(in srgb, var(--ink) 36%, transparent)", opacity: 0.8 }}>
        {text}
      </text>

      {/* traço que se desenha ao montar */}
      <motion.text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="middle"
        strokeWidth="0.35"
        className={textCls}
        style={{ stroke: "color-mix(in srgb, var(--ink) 28%, transparent)" }}
        initial={{ strokeDashoffset: 1000, strokeDasharray: 1000 }}
        animate={{ strokeDashoffset: 0, strokeDasharray: 1000 }}
        transition={{ duration: 3.5, ease: "easeInOut" }}
      >
        {text}
      </motion.text>

      {/* gradiente revelado pelo holofote */}
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" stroke="url(#eav7-text-grad)" strokeWidth="0.7" mask="url(#eav7-text-mask)" className={textCls}>
        {text}
      </text>
    </svg>
  );
}

export function FooterBackgroundGradient() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[70%]"
      style={{
        background:
          "radial-gradient(70% 120% at 50% 120%, color-mix(in srgb, var(--violet) 24%, transparent), transparent 70%)",
      }}
    />
  );
}
