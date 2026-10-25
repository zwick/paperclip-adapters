import { describe, expect, it } from "vitest";
import { buildRunEnv, filterConfigEnv } from "../src/server/run-env.js";

const agent = { id: "agent-1", companyId: "co-1", name: "Tester", adapterType: "copilot_local", adapterConfig: {} } as never;

function build(over: { configEnv?: unknown; authToken?: string; context?: Record<string, unknown> } = {}) {
  return buildRunEnv({
    ctx: {
      runId: "run-1",
      agent,
      authToken: over.authToken,
      context: over.context ?? {},
      runtimeTools: undefined,
    } as never,
    configEnv: over.configEnv,
    executionCwd: "/tmp",
  });
}

describe("filterConfigEnv", () => {
  it("drops every PAPERCLIP_* key regardless of case and keeps the rest", () => {
    const { allowed, dropped } = filterConfigEnv({
      PAPERCLIP_API_KEY: "x",
      paperclip_task_id: "y",
      FOO: "bar",
      NUM: 3,
    });
    expect(allowed).toEqual({ FOO: "bar" });
    expect(dropped.sort()).toEqual(["PAPERCLIP_API_KEY", "paperclip_task_id"]);
  });
});

describe("buildRunEnv", () => {
  it("sets the run token and never lets config.env override it", () => {
    const { env, droppedConfigEnvKeys } = build({
      authToken: "run-token",
      configEnv: { PAPERCLIP_API_KEY: "evil", PAPERCLIP_RUN_ID: "evil", PAPERCLIP_AGENT_ID: "evil", KEEP: "1" },
    });
    expect(env.PAPERCLIP_API_KEY).toBe("run-token");
    expect(env.PAPERCLIP_RUN_ID).toBe("run-1");
    expect(env.PAPERCLIP_AGENT_ID).toBe("agent-1");
    expect(env.KEEP).toBe("1");
    expect(droppedConfigEnvKeys).toContain("PAPERCLIP_API_KEY");
  });

  it("does not expose an API key supplied only through config.env when there is no run token", () => {
    const { env } = build({ configEnv: { PAPERCLIP_API_KEY: "evil" } });
    expect(env.PAPERCLIP_API_KEY).toBeUndefined();
  });

  it("exports the wake context", () => {
    const { env } = build({
      authToken: "t",
      context: {
        taskId: "task-9",
        wakeReason: "issue_assigned",
        wakeCommentId: "c-1",
        approvalId: "ap-1",
        approvalStatus: "approved",
        issueIds: ["i-1", "i-2"],
      },
    });
    expect(env.PAPERCLIP_TASK_ID).toBe("task-9");
    expect(env.PAPERCLIP_WAKE_REASON).toBe("issue_assigned");
    expect(env.PAPERCLIP_WAKE_COMMENT_ID).toBe("c-1");
    expect(env.PAPERCLIP_APPROVAL_ID).toBe("ap-1");
    expect(env.PAPERCLIP_APPROVAL_STATUS).toBe("approved");
    expect(env.PAPERCLIP_LINKED_ISSUE_IDS).toBe("i-1,i-2");
  });

  it("falls back to issueId for the task id", () => {
    expect(build({ context: { issueId: "iss-7" } }).env.PAPERCLIP_TASK_ID).toBe("iss-7");
  });

  it("exports workspace variables from the context", () => {
    const { env } = build({
      context: { paperclipWorkspace: { cwd: "/work/a", source: "project_primary", workspaceId: "w1", repoUrl: "u", repoRef: "main" } },
    });
    expect(env.PAPERCLIP_WORKSPACE_CWD).toBe("/work/a");
    expect(env.PAPERCLIP_WORKSPACE_ID).toBe("w1");
  });
});
