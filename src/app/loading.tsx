// Hjem skeleton while the page's Zaptec/DB calls run: header, hero card, recent events.
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 pt-6 pb-4">
      <div className="flex flex-col gap-2">
        <div className="h-4 w-32 animate-pulse rounded bg-track" />
        <div className="h-8 w-48 animate-pulse rounded bg-track" />
      </div>
      <div className="h-[420px] animate-pulse rounded-[var(--radius-hero)] bg-surface-2" />
      <div className="h-28 animate-pulse rounded-[var(--radius-card)] bg-surface-2" />
    </main>
  );
}
