import { getBlocks, getStatus } from "@/lib/api";
import { BlocksLive } from "@/components/blocks/blocks-live";

export const dynamic = "force-dynamic";

export const metadata = { title: "Blocos · EAV7 Scan" };

export default async function BlocksPage() {
  const [blocks, status] = await Promise.all([
    getBlocks(26).catch(() => []),
    getStatus().catch(() => null),
  ]);

  return <BlocksLive initial={{ blocks, status }} />;
}
