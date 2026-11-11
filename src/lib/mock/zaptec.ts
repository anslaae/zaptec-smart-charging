import "server-only";
import type { ChargerState, ChargeHistoryEntry, ZaptecCharger } from "@/lib/zaptec/types";
import { ZaptecCommand } from "@/lib/zaptec/constants";
import { MOCK_CHARGER } from "./mode";
import { mockLog, mockStore } from "./store";

// Mock versions of src/lib/zaptec/client.ts's exports, backed by the
// in-memory ChargerSim. Same signatures, so callers can't tell the difference.

export function mockListChargers(): ZaptecCharger[] {
  const { sim } = mockStore();
  return [
    {
      id: MOCK_CHARGER.id,
      name: MOCK_CHARGER.name,
      deviceId: "ZAP-MOCK-0001",
      isOnline: sim.settings.online,
      operatingMode: sim.mode,
      installationId: MOCK_CHARGER.installationId,
      installationName: MOCK_CHARGER.installationName,
      circuitId: MOCK_CHARGER.circuitId,
    },
  ];
}

export function mockGetChargerState(chargerId: string): ChargerState {
  return mockStore().sim.toChargerState(chargerId, new Date());
}

export function mockGetInstallationRequiresAuth(): boolean {
  return mockStore().sim.settings.requiresAuth;
}

export function mockGetCircuitMaxCurrentAmps(): number {
  return 16;
}

export function mockGetChargeHistory(chargerId: string): ChargeHistoryEntry[] {
  return mockStore().sim.history.map((entry) => ({ ...entry, chargerId, deviceName: MOCK_CHARGER.name }));
}

const COMMAND_NAMES: Record<number, string> = {
  [ZaptecCommand.ResumeCharging]: "ResumeCharging",
  [ZaptecCommand.StopChargingFinal]: "StopChargingFinal",
};

/** Same contract as the real sendChargerCommand: resolves, or throws on a real failure. */
export function mockSendChargerCommand(chargerId: string, commandId: number): void {
  const result = mockStore().sim.command(commandId, new Date());
  mockLog("command", `${COMMAND_NAMES[commandId] ?? commandId} → ${result.note}`);
  if (!result.accepted) {
    throw new Error(`Zaptec command ${commandId} failed for charger ${chargerId}: ${result.note} (mock)`);
  }
}
