import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  DEFAULT_PAPERCLIP_CONVERSATION_PROMPT_TEMPLATE,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  isPaperclipRecoveryWakePayload,
  isPaperclipSkillSourceMissing,
  joinPromptSections,
  parseObject,
  readPaperclipRuntimeSkillEntries,
  redactEnvForLogs,
  renderTemplate,
  resolveLegacyPaperclipDesiredSkillNames,
  runChildProcess,
  selectInitialCommunicationGuidance,
  selectPaperclipPromptSections,
} from "@paperclipai/adapter-utils/server-utils";
import {
  describeCopilotFailure,
  detectCopilotAuthRequired,
  isCopilotUnknownSessionError,
  parseCopilotJsonl,
} from "./parse.js";
import { resolveCopilotToken, validateCopilotToken } from "./auth.js";
import { isValidGheHost } from "./models.js";
import { applyCopilotProviderEnv } from "./provider.js";
import { buildRunEnv } from "./run-env.js";
import { buildCopilotMcpConfig, managedGatewayServers, mergeMcpServers } from "./mcp.js";
import { loadInstructions, renderApiAccessNote, renderPaperclipEnvNote } from "./prompt.js";
import { readCopilotUsageFile } from "./usage.js";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Env keys the adapter owns; neither config.env nor the process environment may change them. */
const ADAPTER_PINNED_ENV = { COPILOT_AUTO_UPDATE: "false" } as const;

/**
 * Link the agent's desired Paperclip skills into `<runDir>/skills` so Copilot
 * CLI can load them via COPILOT_SKILLS_DIRS. The directory is per-run and is
 * removed afterwards; nothing is written into the workspace or ~/.copilot.
 */
async function prepareSkillsDir(
  config: Record<string, unknown>,
  runDir: string,
  onLog: AdapterExecutionContext["onLog"],
): Promise<string | null> {
  const entries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desired = new Set(resolveLegacyPaperclipDesiredSkillNames(config, entries));
  const skillsDir = path.join(runDir, "skills");
  let linked = 0;
  for (const entry of entries) {
    if (!desired.has(entry.key)) continue;
    if (isPaperclipSkillSourceMissing(entry)) {
      await onLog("stderr", `[paperclip] Warning: Copilot skill "${entry.key}" is enabled but its files are missing; not mounted.\n`);
      continue;
    }
    await fs.mkdir(skillsDir, { recursive: true });
    try {
      await fs.symlink(entry.source, path.join(skillsDir, entry.runtimeName));
      linked += 1;
    } catch (err) {
      await onLog("stderr", `[paperclip] Failed to link Copilot skill "${entry.key}": ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  return linked > 0 ? skillsDir : null;
}

interface AuthResolution {
  tokenSource: string | null;
  providerActive: boolean;
  providerBaseUrl: string | null;
  providerType: string | null;
}

async function applyCopilotAuth(env: Record<string, string>, config: Record<string, unknown>): Promise<AuthResolution> {
  const providerActivation = applyCopilotProviderEnv(env, config);

  const rawGheHost = config.gheHost;
  const gheHost =
    rawGheHost !== undefined && rawGheHost !== null && rawGheHost !== ""
      ? isValidGheHost(rawGheHost)
        ? (rawGheHost as string).trim()
        : undefined
      : undefined;
  const tokenSourceHint = asString(config.tokenSource, "auto");

  let tokenSource: string | null = null;
  const explicitToken = asString(config.githubToken, "").trim();
  if (explicitToken && validateCopilotToken(explicitToken).valid) {
    env.GH_TOKEN = explicitToken;
    tokenSource = "config:githubToken";
  }
  if (!tokenSource && !providerActivation.active) {
    const resolved = await resolveCopilotToken({ ...process.env, ...env }, gheHost, tokenSourceHint);
    if (resolved) {
      env.GH_TOKEN = resolved.token;
      tokenSource = resolved.source;
    }
  }
  const providerConfig = parseObject(config.copilotProvider);
  return {
    tokenSource,
    providerActive: providerActivation.active,
    providerBaseUrl: providerActivation.active ? (providerActivation.baseUrl ?? null) : null,
    providerType: providerActivation.active ? asString(providerConfig.type, "openai") : null,
  };
}

export interface CopilotArgsInput {
  prompt: string;
  resumeSessionId: string | null;
  dangerouslySkipPermissions: boolean;
  model: string;
  effort: string;
  mcpConfigPath: string | null;
  usageFilePath: string;
  extraArgs: string[];
}

export function buildCopilotArgs(input: CopilotArgsInput): string[] {
  const args = ["-p", input.prompt, "--output-format", "json", "-s", "--no-color", "--no-auto-update", "--no-ask-user"];
  if (input.resumeSessionId) args.push(`--resume=${input.resumeSessionId}`);
  args.push(input.dangerouslySkipPermissions ? "--allow-all" : "--allow-all-tools");
  if (input.model) args.push("--model", input.model);
  if (input.effort) args.push("--reasoning-effort", input.effort);
  if (input.mcpConfigPath) args.push("--additional-mcp-config", `@${input.mcpConfigPath}`);
  args.push("--usage-output-file", input.usageFilePath);
  if (input.extraArgs.length > 0) args.push(...input.extraArgs);
  return args;
}

function cancelledResult(base: Partial<AdapterExecutionResult> = {}): AdapterExecutionResult {
  return {
    exitCode: null,
    signal: null,
    timedOut: false,
    ...base,
    errorCode: "cancelled",
    errorMessage: "Copilot execution was cancelled",
    resultJson: {
      ...(base.resultJson ?? {}),
      executionCancellation: { state: "acknowledged", acknowledgedAt: new Date().toISOString() },
    },
  };
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta, signal } = ctx;

  if (ctx.executionTarget && (ctx.executionTarget as { kind?: string }).kind === "remote") {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorCode: "adapter_engine_unavailable",
      errorMessage: "copilot_local does not support remote execution targets",
      resultJson: { executionRecovery: { kind: "bootstrap", providerWorkStarted: false } },
    };
  }

  // Opt in to cooperative cancellation: the host will abort `signal`, stop the
  // spawned process group, and then wait for this function to settle.
  if (signal) await ctx.onCancellationReady?.();
  if (signal?.aborted) {
    return { ...cancelledResult(), executionRecovery: { kind: "bootstrap", providerWorkStarted: false } } as AdapterExecutionResult;
  }

  const promptTemplate = asString(
    config.promptTemplate,
    context.conversationMode === true
      ? DEFAULT_PAPERCLIP_CONVERSATION_PROMPT_TEMPLATE
      : DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  );
  const command = asString(config.command, "copilot");
  const model = asString(config.model, "").trim();
  const effort = asString(config.effort, "").trim();
  const dangerouslySkipPermissions = asBoolean(config.dangerouslySkipPermissions, false);
  const timeoutSec = asNumber(config.timeoutSec, 0);
  const graceSec = asNumber(config.graceSec, 20);
  const extraArgs = (() => {
    const fromExtra = asStringArray(config.extraArgs);
    return fromExtra.length > 0 ? fromExtra : asStringArray(config.args);
  })();

  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const configuredCwd = asString(config.cwd, "");
  const effectiveWorkspaceCwd = workspaceSource === "agent_home" && configuredCwd ? "" : workspaceCwd;
  const cwd = effectiveWorkspaceCwd || configuredCwd || process.cwd();
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const { env, droppedConfigEnvKeys, workspace } = buildRunEnv({
    ctx,
    configEnv: config.env,
    executionCwd: cwd,
    workspaceCwd: effectiveWorkspaceCwd,
  });
  if (droppedConfigEnvKeys.length > 0) {
    await onLog(
      "stderr",
      `[paperclip] Ignored config.env keys reserved for Paperclip: ${droppedConfigEnvKeys.join(", ")}\n`,
    );
  }

  const auth = await applyCopilotAuth(env, config);
  Object.assign(env, ADAPTER_PINNED_ENV);

  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
  await ensureCommandResolvable(command, cwd, runtimeEnv);

  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-copilot-run-"));
  const cleanup = () => fs.rm(runDir, { recursive: true, force: true }).catch(() => undefined);

  try {
    const skillsDir = await prepareSkillsDir(config, runDir, onLog);
    if (skillsDir) env.COPILOT_SKILLS_DIRS = skillsDir;
    else delete env.COPILOT_SKILLS_DIRS;

    const mcpServers = mergeMcpServers(
      ctx.runtimeMcp?.getServers() ?? [],
      managedGatewayServers(context, env.PAPERCLIP_API_URL ?? ""),
    );
    const mcp = buildCopilotMcpConfig(mcpServers);
    let mcpConfigPath: string | null = null;
    if (mcp.names.length > 0) {
      mcpConfigPath = path.join(runDir, "mcp-config.json");
      await fs.writeFile(mcpConfigPath, JSON.stringify(mcp.config), { mode: 0o600 });
    }
    const usageFilePath = path.join(runDir, "usage.json");

    const runtimeSessionParams = parseObject(runtime.sessionParams);
    const runtimeSessionId = asString(runtimeSessionParams.sessionId, runtime.sessionId ?? "");
    const runtimeSessionCwd = asString(runtimeSessionParams.cwd, "");
    const canResumeSession =
      runtimeSessionId.length > 0 &&
      (runtimeSessionCwd.length === 0 || path.resolve(runtimeSessionCwd) === path.resolve(cwd));
    const sessionId = canResumeSession ? runtimeSessionId : null;
    if (runtimeSessionId && !canResumeSession) {
      await onLog(
        "stdout",
        `[paperclip] Copilot session "${runtimeSessionId}" was saved for cwd "${runtimeSessionCwd}" and will not be resumed in "${cwd}".\n`,
      );
    }

    const instructions = await loadInstructions(asString(config.instructionsFilePath, ""));
    if (instructions.error) {
      await onLog(
        "stdout",
        `[paperclip] Warning: could not read agent instructions file "${instructions.filePath}": ${instructions.error}\n`,
      );
    }

    const bootstrapPromptTemplate = asString(config.bootstrapPromptTemplate, "");
    const templateData = {
      agentId: agent.id,
      companyId: agent.companyId,
      runId,
      company: { id: agent.companyId },
      agent,
      run: { id: runId, source: "on_demand" },
      context,
    };

    const buildPrompt = (resumedSession: boolean) => {
      const renderedBootstrap =
        !resumedSession && bootstrapPromptTemplate.trim().length > 0
          ? renderTemplate(bootstrapPromptTemplate, templateData).trim()
          : "";
      const { taskContextNote, wakePrompt } = selectPaperclipPromptSections(context, {
        resumedSession,
        includeCommunicationGuidance: false,
      });
      const useResumeDelta = resumedSession && wakePrompt.length > 0;
      const rendered =
        useResumeDelta || isPaperclipRecoveryWakePayload(context.paperclipWake)
          ? ""
          : renderTemplate(promptTemplate, templateData);
      const sessionHandoffNote = asString(context.paperclipSessionHandoffMarkdown, "").trim();
      const envNote = renderPaperclipEnvNote(env);
      const apiNote = renderApiAccessNote(env);
      const prompt = joinPromptSections([
        selectInitialCommunicationGuidance(context, { resumedSession }),
        instructions.prefix,
        renderedBootstrap,
        wakePrompt,
        taskContextNote,
        sessionHandoffNote,
        envNote,
        apiNote,
        rendered,
      ]);
      return {
        prompt,
        promptMetrics: {
          promptChars: prompt.length,
          instructionsChars: instructions.prefix.length,
          bootstrapPromptChars: renderedBootstrap.length,
          wakePromptChars: wakePrompt.length,
          taskContextChars: taskContextNote.length,
          sessionHandoffChars: sessionHandoffNote.length,
          runtimeNoteChars: envNote.length + apiNote.length,
          heartbeatPromptChars: rendered.length,
        },
      };
    };

    const commandNotes = [
      "Prompt is passed via -p; wake payload, PAPERCLIP_* env notes and agent instructions are prepended.",
      "Set COPILOT_AUTO_UPDATE=false and --no-auto-update (CLI version is pinned by the operator).",
      skillsDir ? `Mounted Paperclip skills via COPILOT_SKILLS_DIRS=${skillsDir}` : "No Paperclip skills mounted.",
      mcp.names.length > 0
        ? `Passed managed MCP servers via --additional-mcp-config: ${mcp.names.join(", ")}`
        : "No managed MCP servers for this run.",
      instructions.filePath && !instructions.error
        ? `Loaded agent instructions from ${instructions.filePath}`
        : instructions.filePath
          ? `Configured instructionsFilePath ${instructions.filePath} could not be read.`
          : "No instructionsFilePath configured.",
    ];

    // Cooperative cancel: track the spawned process group so an abort can stop it
    // even if the host's own termination races with us.
    let spawned: { pid: number; processGroupId: number | null } | null = null;
    let killTimer: NodeJS.Timeout | null = null;
    const killChild = (sig: NodeJS.Signals) => {
      if (!spawned) return;
      try {
        process.kill(spawned.processGroupId ? -spawned.processGroupId : spawned.pid, sig);
      } catch {
        /* already gone */
      }
    };
    const onAbort = () => {
      killChild("SIGTERM");
      killTimer = setTimeout(() => killChild("SIGKILL"), Math.max(1, graceSec) * 1000);
      killTimer.unref?.();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const runAttempt = async (resumeSessionId: string | null) => {
      signal?.throwIfAborted();
      const { prompt, promptMetrics } = buildPrompt(Boolean(resumeSessionId));
      await fs.rm(usageFilePath, { force: true });
      const args = buildCopilotArgs({
        prompt,
        resumeSessionId,
        dangerouslySkipPermissions,
        model,
        effort,
        mcpConfigPath,
        usageFilePath,
        extraArgs,
      });
      if (onMeta) {
        await onMeta({
          adapterType: "copilot_local",
          command,
          cwd,
          commandNotes,
          commandArgs: args.map((v, i) => (i === 1 ? `<prompt ${prompt.length} chars>` : v)),
          env: redactEnvForLogs(env),
          prompt,
          promptMetrics,
          context: {
            ...context,
            copilotTokenSource: auth.tokenSource,
            copilotProviderBaseUrl: auth.providerBaseUrl,
          },
        });
      }
      const proc = await runChildProcess(runId, command, args, {
        cwd,
        env,
        timeoutSec,
        graceSec,
        onLog,
        onSpawn: async (meta) => {
          spawned = { pid: meta.pid, processGroupId: meta.processGroupId ?? null };
          await ctx.onSpawn?.(meta);
          if (signal?.aborted) onAbort();
        },
      });
      return { proc, parsedStream: parseCopilotJsonl(proc.stdout), usageFile: await readCopilotUsageFile(usageFilePath) };
    };

    const toResult = (
      attempt: Awaited<ReturnType<typeof runAttempt>>,
      opts: { fallbackSessionId: string | null; clearSessionOnMissingSession?: boolean },
    ): AdapterExecutionResult => {
      const { proc, parsedStream, usageFile } = attempt;
      const authMeta = detectCopilotAuthRequired({ stdout: proc.stdout, stderr: proc.stderr });

      if (proc.timedOut) {
        return {
          exitCode: proc.exitCode,
          signal: proc.signal,
          timedOut: true,
          errorMessage: `Timed out after ${timeoutSec}s`,
          errorCode: "timeout",
          clearSession: Boolean(opts.clearSessionOnMissingSession),
        };
      }

      const resolvedSessionId = parsedStream.sessionId ?? opts.fallbackSessionId;
      const resolvedSessionParams = resolvedSessionId
        ? {
            sessionId: resolvedSessionId,
            cwd,
            ...(workspace.id ? { workspaceId: workspace.id } : {}),
            ...(workspace.repoUrl ? { repoUrl: workspace.repoUrl } : {}),
            ...(workspace.repoRef ? { repoRef: workspace.repoRef } : {}),
          }
        : null;
      const failed = (proc.exitCode ?? 0) !== 0;
      const errorMessage = failed ? describeCopilotFailure(parsedStream.resultJson, proc.stderr, proc.exitCode) : null;

      const baseResultJson: Record<string, unknown> =
        parsedStream.resultJson ?? (proc.stderr ? { stderr: proc.stderr, stdout: proc.stdout } : {});
      const resultJson = usageFile
        ? {
            ...baseResultJson,
            copilotUsage: {
              premiumRequests: usageFile.premiumRequests,
              aiCredits: usageFile.aiCredits,
              aiCreditsStatus: usageFile.aiCreditsStatus,
              totalApiDurationMs: usageFile.totalApiDurationMs,
            },
          }
        : baseResultJson;

      return {
        exitCode: proc.exitCode,
        signal: proc.signal,
        timedOut: false,
        errorMessage,
        errorCode: failed && authMeta.requiresLogin ? "copilot_auth_required" : null,
        usage: usageFile?.usage ?? parsedStream.usage ?? undefined,
        usageBasis: "per_run",
        sessionId: resolvedSessionId,
        sessionParams: resolvedSessionParams,
        sessionDisplayId: resolvedSessionId,
        provider: auth.providerActive ? (auth.providerType ?? "custom") : "github",
        biller: auth.providerActive ? (auth.providerType ?? "custom") : "github",
        model: usageFile?.model || parsedStream.model || model,
        billingType: auth.providerActive ? "api" : "subscription",
        costUsd: usageFile?.costUsd ?? null,
        resultJson,
        summary: parsedStream.summary,
        clearSession: Boolean(opts.clearSessionOnMissingSession && !resolvedSessionId),
      };
    };

    try {
      const initial = await runAttempt(sessionId);
      if (
        !signal?.aborted &&
        sessionId &&
        !initial.proc.timedOut &&
        (initial.proc.exitCode ?? 0) !== 0 &&
        isCopilotUnknownSessionError(initial.proc.stderr)
      ) {
        await onLog("stdout", `[paperclip] Copilot resume session "${sessionId}" is unavailable; retrying with a fresh session.\n`);
        const retry = await runAttempt(null);
        return signal?.aborted ? cancelledResult() : toResult(retry, { fallbackSessionId: null, clearSessionOnMissingSession: true });
      }
      if (signal?.aborted) {
        return cancelledResult({
          exitCode: initial.proc.exitCode,
          signal: initial.proc.signal,
          usage: initial.usageFile?.usage,
          sessionId: initial.parsedStream.sessionId ?? (runtimeSessionId || null),
        });
      }
      return toResult(initial, { fallbackSessionId: runtimeSessionId || runtime.sessionId });
    } catch (err) {
      if (signal?.aborted) return cancelledResult();
      throw err;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      if (killTimer) clearTimeout(killTimer);
    }
  } finally {
    await cleanup();
  }
}
