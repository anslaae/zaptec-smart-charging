<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project context (not managed by `next dev` — safe to edit)

**Read `HANDOVER.md` before starting work in this repo.** It has the current architecture, deployment status, hard-won Zaptec API facts, the security-model decision (free charging + software enforcement — don't re-litigate without reading it first), debug/health tooling, sandbox gotchas, and the open backlog. This is a live household app with a real user and a real charger, not a sandbox project.

For the deploy/verify/ship loop specifically, use the `ship` skill (`.claude/skills/ship/SKILL.md`) rather than re-deriving the steps.
