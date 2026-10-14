---
name: ship
description: Verify, commit, push, and confirm the Vercel deployment for zaptec-smart-charging. Use after any code change in this repo, before telling the user something is "done" or "deployed."
---

# Ship a change (zaptec-smart-charging)

This repo has no CI — deployment only happens by pushing to `main`, which triggers Vercel's GitHub integration. There is no safety net other than the steps below, so don't skip any of them, and don't report something as done until the deploy actually shows `Ready`.

## 1. Verify

Run all four, in order. Pre-existing warnings (`_prevState`/`_formData` unused-var warnings in the `useActionState` action files) are expected and not a regression — only new errors or new warnings are a problem.

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```

If a schema change was involved, also run `npm run db:generate` (safe, no DB access) *before* the build, read the generated SQL in `drizzle/` to confirm it does what you expect, then `npm run db:migrate` (hits the real production DB via `.env.local`'s `DATABASE_URL` — that's expected and fine).

## 2. Commit

- Stage specific paths, never a bare `git add -A` or `git add .` that could sweep up `.env.local` — and never list `.env.local` explicitly either (a sandbox classifier blocks `git add` calls that name it, even though it's gitignored and would be a no-op).
- End the commit message with the `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer.
- **Known false-positive**: an org-wide guardrail hook occasionally blocks `git commit` with "BLOCKED ... non-approved host" when the message body happens to contain phrases like "now matches", "now fetched", "now split", "now rejects", "now uses", or a bare "now". This is a false positive for this personal repo — reword the sentence and retry. Never use `--no-verify` to route around it.

## 3. Push

```bash
git push origin main
```

- If this returns `remote: Internal Server Error` / `[remote rejected]`, it's a transient GitHub issue (seen before, self-resolves) — wait a bit and retry. Check the actual exit code, not a text match on the output: the *failure* message itself contains the substring `main -> main` (`! [remote rejected] main -> main (...)`), so grepping for that string to detect success gives a false positive.
- After a successful push, check `vercel ls` within ~30 seconds. If no new deployment has appeared (the webhook can occasionally get lost, especially right after a GitHub incident), re-trigger it with an empty commit rather than trying to deploy via the CLI:
  ```bash
  git commit --allow-empty -m "Trigger redeploy (Vercel's webhook missed the previous push)

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  git push origin main
  ```
- **Never run `vercel --prod` / `vercel deploy`** — this is correctly (not a false positive) blocked by the same guardrail hook. Deploys only ever happen via `git push` triggering Vercel's own GitHub integration. Likewise `vercel env add` is blocked (secret-store-writes) — if a new env var is needed, give the user the exact value(s) and ask them to add it via the Vercel dashboard themselves.

## 4. Confirm the deploy

```bash
vercel ls   # top row is the newest deployment — grab its URL
```

Then poll it. **`status` is a reserved/read-only variable name in this zsh environment** — use `dep_status` or similar:

```bash
for i in $(seq 1 15); do
  dep_status=$(vercel inspect <url> 2>/dev/null | grep -m1 "status")
  echo "$dep_status"
  echo "$dep_status" | grep -qE "Ready|Error" && break
  sleep 6
done
```

This will likely exceed the 120s foreground timeout and move to the background — that's fine. When it does, use `ScheduleWakeup` (not a chained `sleep`) to check back, and read the background task's output or re-run `vercel inspect <url>` directly rather than polling impatiently in the same turn.

Optionally, sanity-check the live app itself once `Ready`:

```bash
curl -s https://zaptec-smart-charging.vercel.app/api/health
```

The `sha` field should match the commit you just shipped.

## 5. Report back

Tell the user what shipped, in plain terms (what changed, not a diff), and confirm it's `Ready` — don't say "deployed" until `vercel inspect` actually shows that status.
