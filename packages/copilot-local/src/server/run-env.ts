import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import {
  asString,
  buildPaperclipEnv,
  buildRuntimeToolsEnv,
  parseObject,
  readPaperclipIssueWorkModeFromContext,
  refreshPaperclipWorkspaceEnvForExecution,
} from "@paperclipai/adapter-utils/server-utils";

export interface WorkspaceInfo {
  cwd: string;
  source: string;
  id: string;
  repoUrl: string;
  repoRef: string;
  agentHome: string;
  hints: Array<Record<string, unknown>>;
}

export function readWorkspaceInfo(context: Record<string, unknown>): WorkspaceInfo {
  const ws = parseObject(context.paperclipWorkspace);
  return {
    cwd: asString(ws.cwd, ""),
    source: asString(ws.source, ""),
    id: asString(ws.workspaceId, ""),
    repoUrl: asString(ws.repoUrl, ""),
    repoRef: asString(ws.repoRef, ""),
    agentHome: asString(ws.agentHome, ""),
    hints: Array.isArray(context.paperclipWorkspaces)
      ? context.paperclipWorkspaces.filter(
          (v): v is Record<string, unknown> => typeof v === "object" && v !== null,
        )
      : [],
  };
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Split `config.env` into the entries that may reach the child process and the
 * keys that were dropped. Every `PAPERCLIP_*` key is host-owned: agent config
 * can neither set nor override identity, wake, workspace or auth variables.
 */
export function filterConfigEnv(raw: unknown): { allowed: Record<string, string>; dropped: string[] } {
  const allowed: Record<string, string> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(parseObject(raw))) {
    if (typeof value !== "string") continue;
    if (key.toUpperCase().startsWith("PAPERCLIP_")) {
      dropped.push(key);
      continue;
    }
    allowed[key] = value;
  }
  return { allowed, dropped };
}

/**
 * Build the child environment for one run. Order matters: config.env is applied
 * before the wake/workspace variables, and the run token and run id are written
 * last so nothing earlier can replace them.
 */
export function buildRunEnv(input: {
  ctx: Pick<AdapterExecutionContext, "runId" | "agent" | "context" | "authToken" | "runtimeTools">;
  configEnv: unknown;
  executionCwd: string;
  /** Overrides the workspace cwd reported by the host (agent_home + configured cwd case). */
  workspaceCwd?: string;
  executionTargetIsRemote?: boolean;
}): { env: Record<string, string>; droppedConfigEnvKeys: string[]; workspace: WorkspaceInfo } {
  const { ctx } = input;
  const { context } = ctx;
  const workspace = readWorkspaceInfo(context);
  const { allowed, dropped } = filterConfigEnv(input.configEnv);

  const env: Record<string, string> = {
    ...buildPaperclipEnv(ctx.agent),
    ...buildRuntimeToolsEnv(ctx.runtimeTools),
  };
  env.PAPERCLIP_RUN_ID = ctx.runId;

  const wakeTaskId = nonEmpty(context.taskId) ?? nonEmpty(context.issueId);
  const wakeReason = nonEmpty(context.wakeReason);
  const wakeCommentId = nonEmpty(context.wakeCommentId) ?? nonEmpty(context.commentId);
  const approvalId = nonEmpty(context.approvalId);
  const approvalStatus = nonEmpty(context.approvalStatus);
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
  const issueWorkMode = readPaperclipIssueWorkModeFromContext(context);

  if (wakeTaskId) env.PAPERCLIP_TASK_ID = wakeTaskId;
  if (issueWorkMode) env.PAPERCLIP_ISSUE_WORK_MODE = issueWorkMode;
  if (wakeReason) env.PAPERCLIP_WAKE_REASON = wakeReason;
  if (wakeCommentId) env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  if (approvalId) env.PAPERCLIP_APPROVAL_ID = approvalId;
  if (approvalStatus) env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
  if (linkedIssueIds.length > 0) env.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");

  // Non-PAPERCLIP_* config.env entries are forwarded here; workspace vars are
  // (re)written by the host helper.
  refreshPaperclipWorkspaceEnvForExecution({
    env,
    envConfig: allowed,
    workspaceCwd: input.workspaceCwd ?? workspace.cwd,
    workspaceSource: workspace.source,
    workspaceId: workspace.id,
    workspaceRepoUrl: workspace.repoUrl,
    workspaceRepoRef: workspace.repoRef,
    workspaceHints: workspace.hints,
    agentHome: workspace.agentHome,
    executionTargetIsRemote: input.executionTargetIsRemote ?? false,
    executionCwd: input.executionCwd,
  });

  // Last writes: the harness-minted run token and run id always win.
  if (ctx.authToken) env.PAPERCLIP_API_KEY = ctx.authToken;
  else delete env.PAPERCLIP_API_KEY;
  env.PAPERCLIP_RUN_ID = ctx.runId;

  return { env, droppedConfigEnvKeys: dropped, workspace };
}
