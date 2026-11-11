import "server-only";
import type { StateOfCharge } from "@/lib/smartcar/types";
import { mockStore } from "./store";

// Mock getStateOfCharge(): the simulated car's last report to Smartcar --
// deliberately the stored reading, not the live battery, because the real
// Smartcar data is hours stale too. "Bilen rapporterer" in /dev/mock (or the
// Smartcar webhook button) refreshes it.
export function mockGetStateOfCharge(): StateOfCharge | null {
  const { reading, settings } = mockStore().sim;
  if (settings.smartcarDown) return null;
  return reading ? { percent: reading.percent, oemUpdatedAt: reading.at } : null;
}
