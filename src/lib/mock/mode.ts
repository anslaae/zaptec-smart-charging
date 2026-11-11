// Local mock mode: run and click through the whole app with no database, no
// Zaptec/Smartcar API, no cron and no web push -- everything is simulated in
// memory and reset on restart. Start it with `npm run dev:mock`
// (scripts/dev-mock.mjs sets MOCK_MODE=1). See src/lib/mock/README.md.
export const MOCK_MODE = process.env.MOCK_MODE === "1";

// Never on a real deployment: a mock charger answering "charging started"
// there would be worse than an error.
if (MOCK_MODE && (process.env.VERCEL || process.env.VERCEL_ENV)) {
  throw new Error("MOCK_MODE is for local development only and must never run on Vercel.");
}

/** Fixed ids so the mock database, charger and panel agree. */
export const MOCK_CHARGER = {
  id: "00000000-0000-4000-8000-00000000c001",
  name: "ZAP-MOCK",
  installationId: "00000000-0000-4000-8000-00000000a001",
  installationName: "Konvallveien 1",
  circuitId: "00000000-0000-4000-8000-00000000b001",
} as const;

/** Throws if real outbound traffic is attempted while mocking -- a missed code path must fail loudly. */
export function assertNotMocked(what: string): void {
  if (MOCK_MODE) throw new Error(`[mock] blocked a real ${what} call in MOCK_MODE`);
}
