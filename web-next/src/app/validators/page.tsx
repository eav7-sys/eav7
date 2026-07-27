import { getValidators, getStatus } from "@/lib/api";
import { ValidatorsLive } from "@/components/validators/validators-live";

export const dynamic = "force-dynamic";
export const metadata = { title: "Validadores · EAV7 Scan" };

export default async function ValidatorsPage() {
  const [validators, status] = await Promise.all([
    getValidators().catch(() => null),
    getStatus().catch(() => null),
  ]);

  return <ValidatorsLive initial={{ validators, status }} />;
}
