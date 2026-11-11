import type { NextConfig } from "next";

const MOCK_MODE = process.env.MOCK_MODE === "1";

const nextConfig: NextConfig = {
  // Tab switches without a server round trip: the tab bar prefetches the four
  // tabs fully, and the client keeps them (and visited pages) for a short
  // while. Hjem refreshes its live charger data on arrival when its copy is
  // older than a few seconds (AutoRefresh), and every action revalidates.
  experimental: {
    staleTimes: { dynamic: 30, static: 60 },
  },
  // Mock mode builds into its own folder, so `npm run dev:mock` can run next
  // to a normal `npm run dev` (Next refuses two dev servers sharing .next).
  distDir: MOCK_MODE ? ".next-mock" : ".next",
  env: {
    // Baked in at build time from Vercel's system env vars (always present
    // during the build step, regardless of the project's "expose system env
    // vars at runtime" setting) -- lets the debug panel show exactly which
    // deployment is actually running, to settle "am I seeing the old
    // version?" questions without guessing.
    // `||` rather than `??` -- `vercel env pull` can leave these set to an
    // empty string locally, which `??` wouldn't treat as "missing".
    BUILD_SHA: MOCK_MODE ? "mock" : (process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 7),
    BUILD_ENV: MOCK_MODE ? "mock" : process.env.VERCEL_ENV || "local",
  },
  // PGlite (the mock database) ships WASM and is only ever loaded at runtime
  // in mock mode -- keep it out of the server bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
