# [weekly] Check paperclipai/paperclip#4682 — fetchWithRetry upstream PR

**Date:** 2026-07-20 (fanned out from the retired reminders ledger in agentic)
**Source:** agentic (reminders-ledger triage)
**Affects:** paperclip-adapters/packages/copilot-local

## Observed

Focused PR extracting `fetchWithRetry` from #3629 into `@paperclipai/adapter-utils`; branch `superbiche:feat/adapter-utils-fetch-with-retry`. Once merged AND a release of `@paperclipai/adapter-utils` ships containing it: (1) bump the dep in `packages/copilot-local/package.json`, (2) delete `packages/copilot-local/src/server/fetch-with-retry.ts`, (3) replace imports in `auth.ts` / `models.ts` with `import { fetchWithRetry } from "@paperclipai/adapter-utils/server-utils"`, (4) new patch changeset (no behavior change). Full plan in `.claude/progress-copilot-adapter.md` "fetchWithRetry upstream contribution" section.

## Suggested action

Check PR status; if stalled ≥4 weeks with no maintainer activity, reassess: ping upstream, accept long-term vendor copy, or both.
