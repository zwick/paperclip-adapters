import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import { execute, buildCopilotArgs } from "../src/server/execute.js";

const FIXTURES = path.resolve(__dirname, "fixtures");
const STUB = path.join(FIXTURES, "fake-copilot.mjs");
const USAGE_FIXTURE = path.join(FIXTURES, "usage-output-1.0.103.json");

let tmp: string;
let capturePath: string;
const readCapture = () => JSON.parse(fs.readFileSync(capturePath, "utf8"));

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-exec-test-"));
  capturePath = path.join(tmp, "capture.json");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function makeCtx(over: Partial<AdapterExecutionContext> & { config?: Record<string, unknown>; context?: Record<string, unknown> } = {}) {
  const logs: string[] = [];
  const { config, context, ...rest } = over;
  const ctx = {
    runId: "run-42",
    agent: { id: "agent-1", companyId: "co-1", name: "Tester", adapterType: "copilot_local", adapterConfig: {} },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: {
      command: STUB,
      cwd: tmp,
      githubToken: "github_pat_" + "a".repeat(30),
      env: { CAPTURE_FILE: capturePath, USAGE_FIXTURE },
      ...config,
    },
    context: {
      taskId: "task-1",
      wakeReason: "issue_assigned",
      paperclipTaskCommunicationGuidance: "COMM-GUIDANCE",
      ...context,
    },
    onLog: async (_s: string, chunk: string) => {
      logs.push(chunk);
    },
    authToken: "run-token-xyz",
    ...rest,
  } as unknown as AdapterExecutionContext;
  return { ctx, logs };
}

describe("execute (stub CLI)", () => {
  it("passes the wake env, run token, pinned flags and parses usage + session", async () => {
    const { ctx } = makeCtx({
      config: { env: { CAPTURE_FILE: capturePath, USAGE_FIXTURE, PAPERCLIP_API_KEY: "evil", PAPERCLIP_TASK_ID: "evil", EXTRA_OK: "yes" } },
    });
    const result = await execute(ctx);
    const cap = readCapture();

    expect(cap.env.PAPERCLIP_API_KEY).toBe("run-token-xyz");
    expect(cap.env.PAPERCLIP_TASK_ID).toBe("task-1");
    expect(cap.env.PAPERCLIP_WAKE_REASON).toBe("issue_assigned");
    expect(cap.env.PAPERCLIP_RUN_ID).toBe("run-42");
    expect(cap.env.EXTRA_OK).toBe("yes");
    expect(cap.env.COPILOT_AUTO_UPDATE).toBe("false");
    expect(cap.argv).toContain("--no-auto-update");
    expect(cap.argv).toContain("--output-format");
    expect(cap.argv).toContain("--allow-all-tools");
    expect(cap.argv).toContain("--usage-output-file");
    expect(cap.prompt).toContain("PAPERCLIP_API_KEY");
    expect(cap.prompt).toContain("COMM-GUIDANCE");

    expect(result.exitCode).toBe(0);
    expect(result.errorMessage).toBeNull();
    expect(result.sessionId).toBe("sess-123");
    expect(result.usage).toEqual({ inputTokens: 25928, outputTokens: 4 });
    expect(result.usageBasis).toBe("per_run");
    expect(result.costUsd).toBeCloseTo(0.064858, 6);
    expect(result.model).toBe("claude-sonnet-5.5");
    expect(result.billingType).toBe("subscription");
    expect(result.summary).toContain("done: hello");
  });

  it("falls back to JSONL output tokens when no usage file is written", async () => {
    const { ctx } = makeCtx({ config: { env: { CAPTURE_FILE: capturePath, USAGE_FIXTURE, STUB_NO_USAGE: "1" } } });
    const result = await execute(ctx);
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 4 });
    expect(result.costUsd).toBeNull();
  });

  it("prepends instructionsFilePath contents to the prompt", async () => {
    const file = path.join(tmp, "AGENTS.md");
    fs.writeFileSync(file, "You are the test agent. Obey RULE-7.");
    const { ctx } = makeCtx({ config: { instructionsFilePath: file } });
    await execute(ctx);
    const { prompt } = readCapture();
    expect(prompt).toContain("RULE-7");
    expect(prompt).toContain(`loaded from ${file}`);
    expect(prompt.indexOf("RULE-7")).toBeLessThan(prompt.indexOf("PAPERCLIP_API_KEY"));
  });

  it("warns and continues when the instructions file is unreadable", async () => {
    const { ctx, logs } = makeCtx({ config: { instructionsFilePath: path.join(tmp, "missing.md") } });
    const result = await execute(ctx);
    expect(result.exitCode).toBe(0);
    expect(logs.join("")).toContain("could not read agent instructions file");
  });

  it("delivers runtime MCP servers through a private --additional-mcp-config file, not argv", async () => {
    const { ctx } = makeCtx({
      runtimeMcp: {
        getServers: () => [
          { name: "Paperclip connections", url: "https://host/mcp/connections", token: "SECRET-TOKEN-1", connectionId: "c1" },
          { name: "Paperclip projects", url: "https://host/api/mcp/project-tools", token: "SECRET-TOKEN-2", connectionId: "c2" },
        ],
      },
    });
    await execute(ctx);
    const cap = readCapture();
    expect(Object.keys(cap.mcpConfig.mcpServers)).toEqual(["paperclip-connections", "paperclip-projects"]);
    expect(cap.mcpConfig.mcpServers["paperclip-connections"].headers.Authorization).toBe("Bearer SECRET-TOKEN-1");
    expect(cap.mcpFileMode).toBe("600");
    expect(cap.argv.join(" ")).not.toContain("SECRET-TOKEN");
  });

  it("omits --additional-mcp-config when there are no servers", async () => {
    const { ctx } = makeCtx();
    await execute(ctx);
    expect(readCapture().argv).not.toContain("--additional-mcp-config");
  });

  it("mounts desired skills through COPILOT_SKILLS_DIRS in a per-run dir", async () => {
    const skillSrc = path.join(tmp, "skill-src", "my-skill");
    fs.mkdirSync(skillSrc, { recursive: true });
    fs.writeFileSync(path.join(skillSrc, "SKILL.md"), "---\nname: my-skill\ndescription: x\n---\n");
    const { ctx } = makeCtx({
      config: {
        paperclipRuntimeSkills: [{ key: "paperclipai/paperclip/paperclip", runtimeName: "paperclip", source: skillSrc }],
      },
    });
    await execute(ctx);
    const cap = readCapture();
    expect(cap.env.COPILOT_SKILLS_DIRS).toContain("paperclip-copilot-run-");
    expect(cap.skills).toEqual([{ name: "paperclip", resolved: fs.realpathSync(skillSrc) }]);
    expect(fs.existsSync(cap.env.COPILOT_SKILLS_DIRS)).toBe(false);
    expect(fs.existsSync(path.join(tmp, ".paperclip"))).toBe(false);
  });

  it("forwards model, effort and extra args", async () => {
    const { ctx } = makeCtx({ config: { model: "gpt-5.4", effort: "high", extraArgs: ["--foo"] } });
    await execute(ctx);
    const { argv } = readCapture();
    expect(argv).toEqual(expect.arrayContaining(["--model", "gpt-5.4", "--reasoning-effort", "high", "--foo"]));
  });

  it("acknowledges cancellation: kills the CLI, registers via onCancellationReady, returns executionCancellation", async () => {
    const controller = new AbortController();
    let ready = false;
    const { ctx } = makeCtx({
      config: { graceSec: 2, env: { CAPTURE_FILE: capturePath, USAGE_FIXTURE, STUB_HANG: "1" } },
      signal: controller.signal,
      onCancellationReady: async () => {
        ready = true;
      },
    });
    const pending = execute(ctx);
    const started = capturePath + ".started";
    for (let i = 0; i < 100 && !fs.existsSync(started); i += 1) await new Promise((r) => setTimeout(r, 50));
    expect(fs.existsSync(started)).toBe(true);
    const pid = Number(fs.readFileSync(started, "utf8"));
    controller.abort(new Error("stop"));
    const result = await pending;

    expect(ready).toBe(true);
    expect(result.errorCode).toBe("cancelled");
    expect((result.resultJson as { executionCancellation: { state: string } }).executionCancellation.state).toBe("acknowledged");
    expect(() => process.kill(pid, 0)).toThrow();
  }, 20_000);

  it("returns an acknowledged cancellation without spawning when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { ctx } = makeCtx({ signal: controller.signal, onCancellationReady: async () => {} });
    const result = await execute(ctx);
    expect(result.errorCode).toBe("cancelled");
    expect(fs.existsSync(capturePath)).toBe(false);
  });

  it("refuses remote execution targets", async () => {
    const { ctx } = makeCtx({ executionTarget: { kind: "remote" } as never });
    const result = await execute(ctx);
    expect(result.errorCode).toBe("adapter_engine_unavailable");
  });
});

describe("buildCopilotArgs", () => {
  it("keeps the prompt as the second argument and honours dangerouslySkipPermissions", () => {
    const args = buildCopilotArgs({
      prompt: "P",
      resumeSessionId: "s1",
      dangerouslySkipPermissions: true,
      model: "",
      effort: "",
      mcpConfigPath: "/tmp/m.json",
      usageFilePath: "/tmp/u.json",
      extraArgs: [],
    });
    expect(args.slice(0, 2)).toEqual(["-p", "P"]);
    expect(args).toContain("--resume=s1");
    expect(args).toContain("--allow-all");
    expect(args).not.toContain("--allow-all-tools");
    expect(args).toContain("@/tmp/m.json");
  });
});
