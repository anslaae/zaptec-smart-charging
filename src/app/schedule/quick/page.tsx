import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/dal";
import { listChargers, getChargerState } from "@/lib/zaptec/client";
import { getStateOfCharge } from "@/lib/smartcar/client";
import { getLearnedPowerKw } from "@/lib/scheduler/powerHistory.server";
import { QuickScheduleForm } from "@/components/QuickScheduleForm";

export default async function QuickSchedulePage() {
  await getCurrentUser();
  const [chargers, stateOfCharge, learnedPowerKw] = await Promise.all([
    listChargers(),
    getStateOfCharge(),
    getLearnedPowerKw(),
  ]);
  const charger = chargers[0];
  const chargerState = charger
    ? await getChargerState(charger.id, charger.isOnline, charger.circuitId, charger.installationId)
    : null;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 px-6 py-8">
      <div>
        <Link href="/" className="text-sm text-black/50 underline underline-offset-2 dark:text-white/50">
          ← Back
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Plan charging</h1>
      </div>
      <QuickScheduleForm
        chargers={chargers.map((c) => ({ id: c.id, name: c.name }))}
        chargerState={chargerState}
        stateOfCharge={stateOfCharge}
        learnedPowerKw={learnedPowerKw}
      />
    </main>
  );
}
