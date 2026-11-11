export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 pt-6 pb-4">
      <div className="h-8 w-32 animate-pulse rounded bg-surface-2" />
      <div className="h-12 animate-pulse rounded-[var(--radius-chip)] bg-surface-2" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-[var(--radius-card)] bg-surface-2" />
      ))}
    </main>
  );
}
