export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-6 py-8">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <div className="h-6 w-40 animate-pulse rounded bg-black/10 dark:bg-white/10" />
          <div className="h-4 w-24 animate-pulse rounded bg-black/10 dark:bg-white/10" />
        </div>
      </div>
      <div className="h-36 animate-pulse rounded-xl bg-black/5 dark:bg-white/5" />
      <div className="h-20 animate-pulse rounded-xl bg-black/5 dark:bg-white/5" />
    </main>
  );
}
