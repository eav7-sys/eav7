import Link from "next/link";
import { shortHash } from "@/lib/format";

export function AddrLink({ addr, len = 8 }: { addr: string | null; len?: number }) {
  if (!addr) return <span className="font-mono text-muted">—</span>;
  return (
    <Link href={`/address/${addr}`} className="link-mono text-[11.5px]">
      {shortHash(addr, len, 4)}
    </Link>
  );
}

export function BlockLink({ height }: { height: number }) {
  return (
    <Link href={`/block/${height}`} className="font-semibold text-violet transition hover:text-teal">
      #{height.toLocaleString("pt-BR")}
    </Link>
  );
}

export function TxLink({ id, len = 10 }: { id: string; len?: number }) {
  return (
    <Link href={`/tx/${id}`} className="link-mono text-[11.5px]">
      {shortHash(id, len, 6)}
    </Link>
  );
}
