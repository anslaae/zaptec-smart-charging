import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/dal";
import { listChargers } from "@/lib/zaptec/client";
import { ScheduleForm } from "@/components/ScheduleForm";

export default async function SchedulePage() {
  await getCurrentUser();
  const chargers = await listChargers();

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 px-6 py-8">
      <div>
        <Link href="/" className="text-sm text-black/50 underline underline-offset-2 dark:text-white/50">
          ← Back
        </Link>
        <h1 className="mt-2 text-xl font-semibold">New schedule</h1>
      </div>
      <ScheduleForm chargers={chargers.map((c) => ({ id: c.id, name: c.name }))} />
    </main>
  );
}
