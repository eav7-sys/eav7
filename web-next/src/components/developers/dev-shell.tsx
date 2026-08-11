"use client";

import { usePathname } from "next/navigation";
import { DevMobileNav, DevSidebar } from "./dev-nav";

/**
 * Casca do portal. O hub (`/developers`) é uma composição de borda a borda e não
 * pode ficar preso à coluna do índice — só as páginas de referência ganham a
 * navegação lateral. O pathname só existe no cliente, daí a fronteira aqui.
 */
export function DevShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/developers") return <>{children}</>;

  return (
    <div className="mx-auto w-full max-w-[1240px] px-5">
      <DevMobileNav />
      <div className="grid gap-x-12 lg:grid-cols-[210px_minmax(0,1fr)]">
        <DevSidebar />
        <div className="min-w-0 py-9 lg:py-12">{children}</div>
      </div>
    </div>
  );
}
