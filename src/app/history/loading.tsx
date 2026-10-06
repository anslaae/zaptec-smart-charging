export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-6 py-8">
      <div className="h-6 w-24 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-black/5 dark:bg-white/5" />
        ))}
      </div>
    </main>
  );
}
