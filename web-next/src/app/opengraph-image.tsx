import { ImageResponse } from "next/og";

export const alt = "EAV7 Scan — Explorador da blockchain EAV7";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#0c0b13",
          backgroundImage:
            "radial-gradient(900px 500px at 85% -10%, rgba(99,54,196,0.55), transparent), radial-gradient(700px 460px at -5% 110%, rgba(69,224,230,0.18), transparent)",
          color: "#f2eefb",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="60" height="60" viewBox="0 0 40 40" fill="none">
            <defs>
              <linearGradient id="g" x1="6" y1="4" x2="34" y2="36" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#c9b6ff" />
                <stop offset="0.5" stopColor="#8a6bff" />
                <stop offset="1" stopColor="#45e0e6" />
              </linearGradient>
            </defs>
            <path d="M20 20 L23.1 12.5 L20 4.5 L16.9 12.5 Z" fill="url(#g)" />
            <path d="M20 20 L23.1 12.5 L20 4.5 L16.9 12.5 Z" fill="url(#g)" transform="rotate(60 20 20)" />
            <path d="M20 20 L23.1 12.5 L20 4.5 L16.9 12.5 Z" fill="url(#g)" transform="rotate(120 20 20)" />
            <path d="M20 20 L23.1 12.5 L20 4.5 L16.9 12.5 Z" fill="url(#g)" transform="rotate(180 20 20)" />
            <path d="M20 20 L23.1 12.5 L20 4.5 L16.9 12.5 Z" fill="url(#g)" transform="rotate(240 20 20)" />
            <path d="M20 20 L23.1 12.5 L20 4.5 L16.9 12.5 Z" fill="url(#g)" transform="rotate(300 20 20)" />
            <circle cx="20" cy="20" r="2.4" fill="#45e0e6" />
          </svg>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 2, color: "#45e0e6" }}>
            EAV7 SCAN
          </div>
        </div>
        <div style={{ fontSize: 76, fontWeight: 800, marginTop: 40, lineHeight: 1.05, maxWidth: 900 }}>
          Explorador da blockchain EAV7
        </div>
        <div style={{ fontSize: 30, color: "#9c96b6", marginTop: 24, maxWidth: 820 }}>
          protocolo eav20 · DPoS · segurança pós-quântica · camada nativa de IA
        </div>
      </div>
    ),
    size
  );
}
