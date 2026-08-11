import type { Metadata } from "next";
import { getBlock, getStatus } from "@/lib/api";
import { BlockView } from "@/components/scan/detail/block-view";
import { NotFoundView } from "@/components/scan/detail/shell";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ height: string }>;
}): Promise<Metadata> {
  const { height } = await params;
  const t = await getT();
  return { title: t("page_block.metaTitle", { height }) };
}

export default async function BlockPage({ params }: { params: Promise<{ height: string }> }) {
  const { height } = await params;
  const t = await getT();
  const [block, status] = await Promise.all([
    getBlock(height).catch(() => null),
    getStatus().catch(() => null),
  ]);

  // Altura inexistente é o erro de digitação mais comum num explorador: mostramos
  // uma tela que DIZ o que não foi encontrado, em vez de um 404 genérico ou de uma
  // página em branco, e devolvemos a busca ao usuário.
  if (!block || block.error || block.height == null) {
    return (
      <NotFoundView title={t("scan_detail.nfBlockTitle")} hint={t("scan_detail.nfBlockHint")} query={height} t={t} />
    );
  }

  return <BlockView block={block} status={status} t={t} />;
}
