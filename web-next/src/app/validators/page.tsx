import { Suspense } from "react";
import { getStatus, getValidators } from "@/lib/api";
import { ValidatorsList } from "@/components/scan/lists/validators-list";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("scanLists.titleValidators")} · EAV7 Scan` };
}

export default async function ValidatorsPage() {
  // O nome EAV-NS vem em `/validators` (campo `name`). Esta tela baixava `/names`
  // e invertia o mapa por conta própria — e `/names` corta em 200 registros, então
  // um validador com nome fora dessa fatia aparecia anônimo, sem qualquer aviso.
  const [validators, status] = await Promise.all([
    getValidators().catch(() => null),
    getStatus().catch(() => null),
  ]);

  // Suspense: a lista lê ?tab= via useSearchParams — sem fronteira, uma
  // eventual pré-renderização estática da rota quebraria o build.
  return (
    <Suspense fallback={null}>
      <ValidatorsList inicial={validators} status={status} />
    </Suspense>
  );
}
