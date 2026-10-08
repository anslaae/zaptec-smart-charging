import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Baked in at build time from Vercel's system env vars (always present
    // during the build step, regardless of the project's "expose system env
    // vars at runtime" setting) -- lets the debug panel show exactly which
    // deployment is actually running, to settle "am I seeing the old
    // version?" questions without guessing.
    // `||` rather than `??` -- `vercel env pull` can leave these set to an
    // empty string locally, which `??` wouldn't treat as "missing".
    BUILD_SHA: (process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 7),
    BUILD_ENV: process.env.VERCEL_ENV || "local",
  },
};

export default nextConfig;
