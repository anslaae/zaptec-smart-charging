import "server-only";
import { ChargerSim } from "./charger";

// Process-wide mock state. Kept on globalThis so Next's dev hot-reload (which
// re-evaluates modules) doesn't wipe the simulated charger mid-test; a dev
// server restart does reset everything, by design -- nothing is persisted.

export interface MockLogEntry {
  /** Ever-increasing (survives "Nullstill alt"), so UI tests can wait for a newer line. */
  seq: number;
  at: string;
  kind: "command" | "push" | "incoming" | "info";
  text: string;
}

interface MockStore {
  sim: ChargerSim;
  log: MockLogEntry[];
  seq?: number;
}

const globalForMock = globalThis as typeof globalThis & { __zaptecMockStore?: MockStore };

export function mockStore(): MockStore {
  if (!globalForMock.__zaptecMockStore) {
    globalForMock.__zaptecMockStore = { sim: new ChargerSim(new Date()), log: [] };
  }
  return globalForMock.__zaptecMockStore;
}

/** Newest first, capped, shown in the /dev/mock panel. */
export function mockLog(kind: MockLogEntry["kind"], text: string): void {
  const store = mockStore();
  store.seq = (store.seq ?? 0) + 1;
  store.log.unshift({ seq: store.seq, at: new Date().toISOString(), kind, text });
  if (store.log.length > 200) store.log.length = 200;
  console.log(`[mock:${kind}] ${text}`);
}
