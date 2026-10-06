export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 px-6 py-8">
      <div className="h-6 w-32 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="flex flex-col gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-md bg-black/5 dark:bg-white/5" />
        ))}
      </div>
    </main>
  );
}
