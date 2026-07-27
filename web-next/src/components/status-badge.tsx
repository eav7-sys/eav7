const MAP: Record<string, string> = {
  CONFIRMED: "badge-green",
  PENDING: "badge-gold",
  FAILED: "badge-pink",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${MAP[status] ?? ""}`}>{status.toLowerCase()}</span>;
}
