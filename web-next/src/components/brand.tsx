import Link from "next/link";
import { Logo } from "./logo";

interface BrandProps {
  logoSize?: number;
  className?: string;
  /** "gradient" (header) pinta EAV7 no gradiente da marca; "solid" (footer) usa tinta cheia. */
  tone?: "gradient" | "solid";
  href?: string;
}

// Lockup oficial EAV7 Scan — gema + wordmark. Fonte única para header e footer.
export function Brand({ logoSize = 32, className, tone = "gradient", href = "/" }: BrandProps) {
  return (
    <Link
      href={href}
      aria-label="EAV7 Scan — início"
      className={`group flex flex-none items-center gap-2.5 ${className ?? ""}`}
    >
      <Logo
        size={logoSize}
        className="transition-transform duration-300 ease-out group-hover:-rotate-6 group-hover:scale-105"
      />
      <span className="font-display flex items-baseline leading-none">
        <span
          className={`text-[18px] font-extrabold tracking-[-0.03em] ${
            tone === "gradient" ? "grad-text" : "text-ink"
          }`}
        >
          EAV7
        </span>
        <span className="ml-[7px] text-[11px] font-bold uppercase tracking-[0.3em] text-muted transition-colors duration-300 group-hover:text-ink">
          Scan
        </span>
      </span>
    </Link>
  );
}
