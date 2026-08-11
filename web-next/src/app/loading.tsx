export default function Loading() {
  return (
    <div className="mx-auto max-w-[1180px] px-5 py-8">
      <div className="mb-6 h-8 w-64 animate-pulse rounded-lg bg-line" />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card h-[92px] animate-pulse" />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card h-72 animate-pulse" />
        <div className="card h-72 animate-pulse" />
      </div>
    </div>
  );
}
