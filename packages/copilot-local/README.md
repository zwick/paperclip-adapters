# @zwicker-software/copilot-paperclip-adapter

Paperclip external adapter (`copilot_local`) that runs the [GitHub Copilot CLI](https://docs.github.com/copilot/how-tos/copilot-cli).
Zwicker Software fork of `@superbiche/copilot-paperclip-adapter` 0.2.1 (MIT, see [NOTICE.md](./NOTICE.md)) with the full
Paperclip run contract that the upstream bridge lacked.

## What the fork adds over 0.2.1

| # | Capability | How |
|---|---|---|
| 1 | Wake prompt + full `PAPERCLIP_*` env | `selectPaperclipPromptSections` (wake payload, task context, handoff, resume delta) and `PAPERCLIP_TASK_ID`, `_WAKE_REASON`, `_WAKE_COMMENT_ID`, `_APPROVAL_*`, `_LINKED_ISSUE_IDS`, workspace vars. Same sections as `gemini_local`. |
| 2 | Run API key | `PAPERCLIP_API_KEY = ctx.authToken`, written last. `config.env` can never set or override any `PAPERCLIP_*` key (dropped keys are logged). |
| 3 | Managed instructions | `instructionsFilePath` is read each run and prepended to the prompt with the relative-path directive. |
| 4 | Connections tools / managed MCP | `ctx.runtimeMcp` servers (and `paperclipManagedMcp` gateways when the host supplies them) go to `--additional-mcp-config @<file>`. The file is `0600` in a per-run temp dir, so bearer tokens never appear on the command line. `runtimeToolDelivery: "native_mcp"`. |
| 5 | Cooperative cancel | Registers with `onCancellationReady`; on `ctx.signal` abort it SIGTERMs the CLI process group (SIGKILL after `graceSec`) and returns `executionCancellation.state = "acknowledged"`. |
| 6 | Usage | `--usage-output-file` is parsed: input/output/cached tokens summed over `modelMetrics`, `costUsd` from `totalNanoAiu` (1 AI credit = $0.01), premium requests and credits in `resultJson.copilotUsage`. Falls back to JSONL output tokens if the file is missing. |
| - | CLI pinning | Always `COPILOT_AUTO_UPDATE=false` + `--no-auto-update`; `testEnvironment` warns if the installed CLI differs from the verified version (`PINNED_COPILOT_CLI_VERSION` = 1.0.103). |
| - | Skills | Host skill-snapshot API; per-run `COPILOT_SKILLS_DIRS`. |

Kept from upstream: GitHub token resolution (`githubToken`, env, `gh auth token`), provider BYOK (`copilotProvider`), GHE support, dynamic model discovery, session resume (`--resume=<id>` with stale-session retry), JSONL log parsing, UI parser.

Not supported: remote/sandbox execution targets (returns `adapter_engine_unavailable`).

## Pinned versions

- Copilot CLI **1.0.103** (`npm i -g @github/copilot@1.0.103`). Verified: `-p`, `--output-format json`, `--additional-mcp-config`, `--usage-output-file`, `--reasoning-effort` (alias `--effort`), `--no-auto-update`, `--no-ask-user`, `--resume`, `COPILOT_SKILLS_DIRS`, `COPILOT_AUTO_UPDATE`.
- `@paperclipai/adapter-utils` **2026.1005.0** (exact pin, matches host Paperclip 2026.1005.0).

## Install (normal plugin)

This package lives in the pnpm workspace `zwick/paperclip-adapters` at `packages/copilot-local`. Nothing is published to npm. Build a self-contained package directory that lives **outside** the managed plugins dir (so other plugin installs/reinstalls never touch it), then register it as a local-path adapter:

```bash
git clone https://github.com/zwick/paperclip-adapters && cd paperclip-adapters
pnpm install && pnpm build && pnpm test
cd packages/copilot-local
pnpm pack                                  # zwicker-software-copilot-paperclip-adapter-0.3.0.tgz
mkdir -p /opt/paperclip-plugins/copilot && tar -xzf *.tgz -C /opt/paperclip-plugins/copilot --strip-components=1
(cd /opt/paperclip-plugins/copilot && npm install --omit=dev --ignore-scripts)

curl -X POST http://127.0.0.1:3100/api/adapters/install \
  -H 'content-type: application/json' \
  -d '{"packageName":"/opt/paperclip-plugins/copilot","isLocalPath":true}'
```

(`/opt/paperclip-plugins/copilot` is an example; any stable directory works.) A tarball path cannot be passed as `packageName` without `isLocalPath`: the host would treat the path as the npm package name. The host never "reinstalls" local-path adapters, it only reloads them.

The adapter type stays `copilot_local`, so it replaces the registered `@superbiche/copilot-paperclip-adapter` entry in `~/.paperclip/adapter-plugins.json`. **Existing agents are untouched by installing; switching them over is a separate, approved cutover.** Test first on an isolated Paperclip home: see [docs/ISOLATED-INSTALL.md](docs/ISOLATED-INSTALL.md).

## Rollback to 0.2.1

0.2.1 is the unmodified upstream `@superbiche/copilot-paperclip-adapter@0.2.1`. It stays in the git history of this repo: `packages/copilot-local` at commit `cc16459` (the fork's `main` before 0.3.0 landed) is byte-identical to upstream 0.2.1.

1. Stop Paperclip.
2. Build 0.2.1 from the fork, or install it from npm:
   ```bash
   git clone https://github.com/zwick/paperclip-adapters && cd paperclip-adapters
   git checkout cc16459
   pnpm install && pnpm --filter @superbiche/copilot-paperclip-adapter build
   # then pack and register this directory as in "Install (normal plugin)", or:
   # POST /api/adapters/install {"packageName":"@superbiche/copilot-paperclip-adapter@0.2.1"}
   ```
   Alternatively restore the saved plugin snapshot and registry from the Phase 0 backup (`copilot-adapter-backup-0.2.1/` in the Leo McGarry workspace: `full-plugin-snapshot-0.2.1-patched/`, `adapter-plugins.json`, `SHA256SUMS`, README with exact commands). That snapshot includes `execute.js.local-patch.diff`.
3. Start Paperclip and run an agent environment test.

Both packages register the adapter type `copilot_local`, so installing one replaces the other. Agent configuration does not need to change in either direction.

## Upkeep

- **Copilot CLI upgrades are manual.** Install the new version, run `node scripts/smoke-live.mjs` (about 1 premium request) and `npm test`, then bump `PINNED_COPILOT_CLI_VERSION` in `src/index.ts`. Watch for changes to `--additional-mcp-config`, `--usage-output-file` schema, JSONL event names, `COPILOT_SKILLS_DIRS` (undocumented).
- **Paperclip upgrades:** bump the `@paperclipai/adapter-utils` pin to the new host version, `npm run typecheck`, compare `adapter-gemini-local/dist/server/execute.js` against `src/server/execute.ts` for new context fields (the template we follow).
- Upstream `@superbiche` releases: review the diff against commit `4fc467f`, cherry-pick auth/model/provider fixes.

## Known limits

- The prompt is passed as a single `-p` argument. Very large prompts (hundreds of KB) can hit OS argv limits; stdin prompting is unverified.
- Copilot masks `Authorization: Bearer $PAPERCLIP_API_KEY` as `******` in its echoed user message (observed in 1.0.103 output); the model still ran authenticated commands correctly. `--secret-env-vars` is intentionally **not** used because it would strip `PAPERCLIP_API_KEY` from the agent's shell.
- `costUsd` is derived from AI credits and informational for subscription auth.
- Cancel is verified against a stub CLI and the host contract, not against a live Copilot run.

## Agent config

Create a Paperclip agent with `adapterType: "copilot_local"`.

### Minimal (host-inherited auth)

```json
{
  "adapterType": "copilot_local",
  "adapterConfig": {
    "command": "copilot",
    "model": "claude-sonnet-4.6",
    "timeoutSec": 600
  }
}
```

The host's `~/.copilot/` state (after `copilot login`) is used. No token in the agent config.

### GitHub-side BYOK (multi-tenant Copilot subscription)

```json
{
  "adapterType": "copilot_local",
  "adapterConfig": {
    "command": "copilot",
    "model": "claude-sonnet-4.6",
    "githubToken": { "secret_ref": "GITHUB_FINE_GRAINED_PAT" },
    "tokenSource": "auto"
  }
}
```

Use a fine-grained PAT (`github_pat_…`) or an OAuth token (`gho_…` / `ghu_…`). Classic PATs (`ghp_…`) are rejected with a clear error. The token is injected into the spawn env as `GH_TOKEN`; never logged.

### Provider BYOK — local llama.cpp / Ollama (no GitHub Copilot subscription)

```json
{
  "adapterType": "copilot_local",
  "adapterConfig": {
    "command": "copilot",
    "model": "qwen-coder",
    "copilotProvider": {
      "baseUrl": "http://localhost:11434/v1",
      "type": "openai",
      "apiKey": "ollama"
    }
  }
}
```

For an authenticated llama.cpp server:

```json
{
  "adapterConfig": {
    "command": "copilot",
    "model": "coder-qwen3.6-q6_k_xl",
    "copilotProvider": {
      "baseUrl": "http://homelab.lan:8000/v1",
      "type": "openai",
      "bearerToken": { "secret_ref": "LLAMA_API_KEY_HL1" }
    }
  }
}
```

### Provider BYOK — Anthropic direct

```json
{
  "adapterConfig": {
    "command": "copilot",
    "model": "claude-sonnet-4-5-20250929",
    "copilotProvider": {
      "baseUrl": "https://api.anthropic.com/v1",
      "type": "anthropic",
      "apiKey": { "secret_ref": "ANTHROPIC_API_KEY" }
    }
  }
}
```

In provider-BYOK mode, `COPILOT_PROVIDER_BASE_URL` activates the bypass — GitHub Copilot's routing is skipped entirely. Per `copilot help providers`: *"GitHub authentication is not required when using a custom provider."*

### GitHub Enterprise

```json
{
  "adapterType": "copilot_local",
  "adapterConfig": {
    "command": "copilot",
    "gheHost": "corp.ghe.com",
    "tokenSource": "gh_cli"
  }
}
```

The token is fetched via `gh auth token --hostname corp.ghe.com`, the `/models` endpoint is discovered via `https://api.corp.ghe.com/copilot_internal/user`, and env-var fallback is suppressed (SSRF guard).

### Skills

Skills declared by Paperclip's runtime (`paperclipRuntimeSkills`) are symlinked into a **per-run temp directory** that is passed to Copilot CLI via `COPILOT_SKILLS_DIRS` and deleted afterwards. Nothing is written into the workspace or `~/.copilot`. The operational `paperclip` skill is always mounted.

Full config surface is documented in the adapter's `agentConfigurationDoc` — exposed via `GET /api/adapters/copilot_local` on a Paperclip instance that has the adapter installed.

## License

MIT. See [`LICENSE`](./LICENSE) and [`NOTICE.md`](./NOTICE.md).
