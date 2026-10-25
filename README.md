# paperclip-adapters

External adapter pack for [paperclipai/paperclip](https://github.com/paperclipai/paperclip) — adds runtime support for new agent CLIs beyond the builtin set.

Each adapter ships as its own npm package under `@superbiche/*`. They plug into a Paperclip instance via the external adapter plugin system (`POST /api/adapters/install`).

## Packages

> This is the `zwick/paperclip-adapters` fork. npm publishing is disabled here: `.github/workflows/release.yml` only opens version PRs. `packages/copilot-local` is renamed to `@zwicker-software/copilot-paperclip-adapter` and is installed from a checkout with `isLocalPath` (see its README). The `@superbiche/*` names below belong to the upstream maintainer.

| Package | Wraps | Version |
|---|---|---|
| [`@superbiche/cline-paperclip-adapter`](./packages/cline-local) | [Cline CLI 2.x](https://github.com/cline/cline) | [![npm](https://img.shields.io/npm/v/@superbiche/cline-paperclip-adapter.svg)](https://www.npmjs.com/package/@superbiche/cline-paperclip-adapter) |
| [`@zwicker-software/copilot-paperclip-adapter`](./packages/copilot-local) | [GitHub Copilot CLI](https://docs.github.com/copilot/how-tos/copilot-cli) | 0.3.0 (Zwicker Software fork of `@superbiche/copilot-paperclip-adapter` 0.2.1; not published to npm) |
| [`@superbiche/qwen-paperclip-adapter`](./packages/qwen-local) | [Qwen Code CLI](https://github.com/QwenLM/qwen-code) | [![npm](https://img.shields.io/npm/v/@superbiche/qwen-paperclip-adapter.svg)](https://www.npmjs.com/package/@superbiche/qwen-paperclip-adapter) |

Every adapter declares `sessionManagement` with `supportsSessionResume: true`. Their CLI-native session handles (`cline -T <taskId>`, `copilot --resume=<sessionId>`, `qwen -r <sessionId>`) round-trip through Paperclip's `agent_task_sessions` table and resume across heartbeats.

## Quickstart

```bash
pnpm install
pnpm build
pnpm test
```

## Installing an adapter into a Paperclip instance

**Local path (dev / Berceuse smoke):**

```bash
curl -X POST http://127.0.0.1:3100/api/adapters/install \
  -H 'content-type: application/json' \
  -d '{"packageName":"/absolute/path/to/paperclip-adapters/packages/cline-local","isLocalPath":true}'
```

On paperclip built from commit `3d15798` or later (ships in `canary/v2026.423.0-canary.2` and the next stable), hot-install picks up `sessionManagement` without a restart. On older releases (v2026.416.0 and prior, pre-[paperclipai/paperclip#4324](https://github.com/paperclipai/paperclip/pull/4324)), restart Paperclip once after install so the IIFE path can register it.

**npm (once published):**

```bash
curl -X POST http://127.0.0.1:3100/api/adapters/install \
  -H 'content-type: application/json' \
  -d '{"packageName":"@superbiche/cline-paperclip-adapter"}'
```

## Adapter authoring notes

Gaps in Paperclip's plugin system that affect adapter authors — branches on [`superbiche/paperclip`](https://github.com/superbiche/paperclip), open/upstream PRs, deferred items — live in [`docs/authoring-gaps.md`](./docs/authoring-gaps.md).

## Release process

Versioning uses [changesets](https://github.com/changesets/changesets). **This fork does not publish to npm.** The Release workflow (`.github/workflows/release.yml`) opens a "chore(release): version packages" PR when changesets are pending, and stops there. It has no `publish` step, no `id-token` permission, and no npm token.

To ship a change:

1. Make your code change on a branch.
2. Run `pnpm exec changeset` and answer the prompts. This generates `.changeset/<slug>.md`.
3. Commit the changeset file alongside your code change. Open a PR, review, merge to `main`.
4. The Release workflow opens or updates the version PR (version bumps and CHANGELOG entries). Merge it to record the version.
5. To deploy, build from a checkout and install with `isLocalPath` (see `packages/copilot-local/README.md`). Installing into Paperclip needs board approval.

Upstream's npm trusted-publisher flow was removed on purpose. Do not run `npm publish` and do not add an `NPM_TOKEN`.

## License

MIT
