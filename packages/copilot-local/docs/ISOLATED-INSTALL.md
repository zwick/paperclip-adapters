# Isolated install test

Verifies the package loads through the real Paperclip plugin loader without touching `~/.paperclip`.

```bash
ISO=$(mktemp -d)
npm run build && npm pack --pack-destination "$ISO"
mkdir -p "$ISO/local/copilot" "$ISO/home"
tar -xzf "$ISO"/*.tgz -C "$ISO/local/copilot" --strip-components=1
(cd "$ISO/local/copilot" && npm install --omit=dev --ignore-scripts)

PAPERCLIP_HOME="$ISO/home" PAPERCLIP_INSTANCE_ID=iso \
  node scripts/verify-host-load.mjs "$ISO/local/copilot"
```

The script refuses to run without `PAPERCLIP_HOME`. Expected output: type `copilot_local`, `runtimeToolDelivery: native_mcp`, `supportsLocalAgentJwt: true`, all six adapter functions present, `buildExternalAdapters -> copilot_local`, `testEnvironment` status `warn` or `pass` (hello probe may warn about auth in an empty `COPILOT_HOME`), `listSkills` mode `ephemeral`.

Afterwards confirm the real registry is unchanged (`shasum ~/.paperclip/adapter-plugins.json`) and delete `$ISO`.

For a live end-to-end check (about 1 premium request): `COPILOT_HOME=$(mktemp -d) GH_TOKEN=... node scripts/smoke-live.mjs`.
