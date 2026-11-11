// `npm run dev:mock` -- the whole app on http://localhost:3100 with no
// database, Zaptec, Smartcar, cron or web push: everything is simulated in
// memory and reset on restart (src/lib/mock/). Runs next to `npm run dev`.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const projectDir = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const child = spawn(process.execPath, [nextBin, "dev", "--port", "3100"], {
  cwd: projectDir,
  stdio: "inherit",
  env: { ...process.env, MOCK_MODE: "1" },
});
child.on("exit", (code) => process.exit(code ?? 0));
