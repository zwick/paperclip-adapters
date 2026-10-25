#!/usr/bin/env node
// Live smoke test: runs ONE real Copilot CLI turn through execute() and checks items 1-6.
// Costs about one premium request. Needs a built dist/ and GH_TOKEN (or a logged-in copilot).
// Usage: COPILOT_HOME=$(mktemp -d) node scripts/smoke-live.mjs [model]
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execute } from "../dist/server/execute.js";

const model = process.argv[2] ?? process.env.SMOKE_MODEL ?? "";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-smoke-"));
const EXPECT_TOKEN = "smoke-mcp-token";
let mcpAuthSeen = null;
let mcpToolCalled = false;

// Minimal MCP (streamable HTTP, JSON responses) with one tool.
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    mcpAuthSeen = req.headers.authorization ?? mcpAuthSeen;
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    const msg = body ? JSON.parse(body) : {};
    const reply = (result) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
    };
    if (msg.method === "initialize") return reply({ protocolVersion: msg.params?.protocolVersion ?? "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "smoke", version: "1" } });
    if (msg.method === "notifications/initialized") { res.writeHead(202).end(); return; }
    if (msg.method === "tools/list") return reply({ tools: [{ name: "smoke_ping", description: "Returns the smoke code word.", inputSchema: { type: "object", properties: {} } }] });
    if (msg.method === "tools/call") { mcpToolCalled = true; return reply({ content: [{ type: "text", text: "MCPWORD-OSPREY" }] }); }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const skillSrc = path.join(tmp, "src-skills", "smoke-skill");
fs.mkdirSync(skillSrc, { recursive: true });
fs.writeFileSync(path.join(skillSrc, "SKILL.md"), "---\nname: smoke-skill\ndescription: Smoke test skill. Its code word is SKILLWORD-HERON.\n---\nThe smoke skill code word is SKILLWORD-HERON.\n");
const instr = path.join(tmp, "AGENTS-smoke.md");
fs.writeFileSync(instr, "Smoke instructions: the instructions code word is INSTRWORD-LYNX.\n");
const cwd = path.join(tmp, "cwd");
fs.mkdirSync(cwd);

let sawSpawn = false;
const result = await execute({
  runId: "smoke-run-1",
  agent: { id: "agent-smoke", companyId: "co-smoke", name: "Smoke", adapterType: "copilot_local", adapterConfig: {} },
  runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
  config: {
    cwd,
    model: model || undefined,
    instructionsFilePath: instr,
    paperclipRuntimeSkills: [{ key: "smoke/smoke-skill", runtimeName: "smoke-skill", source: skillSrc }],
    paperclipSkillSync: { desiredSkills: ["smoke/smoke-skill"] },
    env: { PAPERCLIP_API_KEY: "evil-override" },
    promptTemplate:
      "Smoke test, be brief. Do all four: (1) run the shell command: echo \"$PAPERCLIP_TASK_ID $PAPERCLIP_WAKE_REASON ${#PAPERCLIP_API_KEY} ${PAPERCLIP_API_KEY:0:8}\" and report its output; " +
      "(2) state the instructions code word from your instructions; (3) state the code word of the smoke-skill skill (use the skill); (4) call the smoke_ping MCP tool and report its text. Reply as four numbered lines.",
    timeoutSec: 240,
  },
  context: { taskId: "TASK-SMOKE", wakeReason: "issue_assigned" },
  authToken: "RUNTOKEN-FALCON",
  runtimeMcp: { getServers: () => [{ name: "Smoke MCP", url: `http://127.0.0.1:${port}/mcp`, token: EXPECT_TOKEN, connectionId: "smoke" }] },
  onSpawn: async () => { sawSpawn = true; },
  onMeta: async (m) => console.log("[meta] args:", JSON.stringify(m.commandArgs), "\n[meta] notes:", m.commandNotes),
  onLog: async (_s, c) => process.stderr.write(c),
});
server.close();

console.log("\n--- result ---");
console.log(JSON.stringify({ exitCode: result.exitCode, errorCode: result.errorCode, errorMessage: result.errorMessage, usage: result.usage, costUsd: result.costUsd, model: result.model, sessionId: result.sessionId, sawSpawn }, null, 2));
console.log("summary:", result.summary);
console.log("mcp auth header seen:", mcpAuthSeen === `Bearer ${EXPECT_TOKEN}`, "| tool called:", mcpToolCalled);
