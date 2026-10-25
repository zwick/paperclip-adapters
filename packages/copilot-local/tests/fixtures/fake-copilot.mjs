#!/usr/bin/env node
// Stand-in for the Copilot CLI: records what it was given and emits the JSONL + usage file shapes of 1.0.103.
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
if (argv.includes("--version")) {
  console.log("GitHub Copilot CLI 1.0.103.");
  process.exit(0);
}

const mcpArg = flag("--additional-mcp-config");
const skillsDirs = process.env.COPILOT_SKILLS_DIRS;
const capture = {
  argv,
  prompt: flag("-p"),
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PAPERCLIP_|COPILOT_|GH_TOKEN|CAPTURE|STUB_|EXTRA_)/.test(k))),
  mcpConfig: mcpArg && mcpArg.startsWith("@") ? JSON.parse(fs.readFileSync(mcpArg.slice(1), "utf8")) : null,
  mcpFileMode: mcpArg && mcpArg.startsWith("@") ? (fs.statSync(mcpArg.slice(1)).mode & 0o777).toString(8) : null,
  skills: skillsDirs && fs.existsSync(skillsDirs) ? fs.readdirSync(skillsDirs).map((n) => ({ name: n, resolved: fs.realpathSync(path.join(skillsDirs, n)) })) : [],
  cwd: process.cwd(),
};
fs.writeFileSync(process.env.CAPTURE_FILE, JSON.stringify(capture));

if (process.env.STUB_HANG) {
  fs.writeFileSync(process.env.CAPTURE_FILE + ".started", String(process.pid));
  setTimeout(() => {}, 60_000);
} else {
  const usageFile = flag("--usage-output-file");
  if (usageFile && !process.env.STUB_NO_USAGE) {
    fs.copyFileSync(process.env.USAGE_FIXTURE, usageFile);
  }
  const model = "claude-sonnet-5.5";
  console.log(JSON.stringify({ type: "session.tools_updated", data: { model } }));
  console.log(JSON.stringify({ type: "assistant.message", data: { content: "done: hello", outputTokens: 4 } }));
  console.log(JSON.stringify({ type: "result", sessionId: "sess-123", exitCode: 0, usage: { premiumRequests: 1 } }));
}
