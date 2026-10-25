# NOTICE

`@zwicker-software/copilot-paperclip-adapter` is a fork of
[`@superbiche/copilot-paperclip-adapter`](https://github.com/superbiche/paperclip-adapters) **0.2.1** (MIT).
The fork baseline is commit `4fc467f` in this repository (verbatim import of 0.2.1).

The original copyright notice is preserved in [`LICENSE`](./LICENSE):

    MIT License
    Copyright (c) 2026 Michel Tomas / Superbiche

Zwicker Software modifications (0.3.0 onward) are released under the same MIT terms.

## Attribution carried over from upstream

The runtime of this adapter combines work from two upstream PRs against [`paperclipai/paperclip`](https://github.com/paperclipai/paperclip):

- **Foundation** — `src/server/execute.ts`, `src/server/parse.ts`, `src/server/test.ts`, `src/ui-parser.ts`, the JSONL parsing, transcript translation, stale-session retry logic, and the initial 54-test suite were **originally authored by [@tjp2021](https://github.com/tjp2021)** in PR [paperclipai/paperclip#2085](https://github.com/paperclipai/paperclip/pull/2085) as an in-tree `packages/adapters/copilot-local` package. Greptile gave the PR a 5/5 confidence score.

- **Auth + features** — `src/server/auth.ts` (token resolution + endpoint discovery + token-fingerprint cache), `src/server/models.ts` (dynamic model discovery), `src/server/detect-model.ts`, `src/server/skills.ts` (skill injection via `COPILOT_SKILLS_DIRS`), the `fetchWithRetry` helper, and the BYOK / GHE / multi-tenant identity handling were **authored by [@HearthCore](https://github.com/HearthCore)** in PR [paperclipai/paperclip#3629](https://github.com/paperclipai/paperclip/pull/3629). The Greptile-flagged SSRF P1 was already addressed at HEAD by HearthCore; this port adds defense-in-depth `gheHost` format validation on top.

After PR [paperclipai/paperclip#2218](https://github.com/paperclipai/paperclip/pull/2218) shipped the external adapter plugin system, the ecosystem direction shifted toward third-party adapter packages over in-tree additions. With both PRs sitting unmerged in the upstream queue, the adapter was assembled out-of-tree into this external package — preserving both authors' work, with the SSRF defense-in-depth fix applied during port and provider-BYOK (`adapterConfig.copilotProvider`) added as a new first-class config surface for the use case Copilot CLI's `copilot help providers` actually documents.

The external-plugin port — `src/server/index.ts` factory exposing `createServerAdapter()`, `sessionManagement` declaration, inlined self-contained `src/ui-parser.ts`, `src/server/provider.ts` provider-BYOK validation/injection, stand-alone `tsconfig.json`, and the workspace packaging — was done by [@superbiche](https://github.com/superbiche) / [@tsbwc](https://github.com/tsbwc). Smoke-tested end-to-end against a paperclip-dev instance with both GitHub-mode and provider-mode (homelab llama.cpp via `coder-qwen3.6-q6_k_xl`).

## What this fork changed

See [`CHANGELOG.md`](./CHANGELOG.md). In short: `execute.ts` was rewritten around the `gemini_local`
pattern from the host `@paperclipai/adapter-utils`; `skills.ts` moved to the host skill-snapshot API;
`run-env.ts`, `mcp.ts`, `usage.ts`, `prompt.ts` are new. Auth (`auth.ts`), provider BYOK (`provider.ts`),
model discovery (`models.ts`, `detect-model.ts`), `fetch-with-retry.ts`, JSONL parsing (`parse.ts`)
and the UI parser (`ui-parser.ts`) are upstream code with small edits.
