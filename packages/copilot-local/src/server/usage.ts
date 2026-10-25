import fs from "node:fs/promises";
import type { UsageSummary } from "@paperclipai/adapter-utils";
import { asNumber, parseObject } from "@paperclipai/adapter-utils/server-utils";

/** 1 GitHub AI credit = $0.01; `totalNanoAiu` is in billionths of a credit. */
const USD_PER_AI_CREDIT = 0.01;
const NANO = 1_000_000_000;

export interface CopilotUsageFile {
  usage: UsageSummary;
  costUsd: number | null;
  aiCredits: number | null;
  aiCreditsStatus: string | null;
  premiumRequests: number;
  model: string | null;
  totalApiDurationMs: number;
  raw: Record<string, unknown>;
}

/** Parse the JSON written by `copilot --usage-output-file`. Returns null when it is not a usage document. */
export function parseCopilotUsageFile(text: string): CopilotUsageFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const raw = parseObject(parsed);
  if (Object.keys(raw).length === 0) return null;

  const metrics = parseObject(raw.modelMetrics);
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheRead = 0;
  let topModel: { name: string; tokens: number } | null = null;
  for (const [name, value] of Object.entries(metrics)) {
    const usage = parseObject(parseObject(value).usage);
    const input = asNumber(usage.inputTokens, 0);
    const output = asNumber(usage.outputTokens, 0);
    inputTokens += input;
    outputTokens += output;
    cacheRead += asNumber(usage.cacheReadTokens, 0);
    if (!topModel || input + output > topModel.tokens) topModel = { name, tokens: input + output };
  }

  const nano = typeof raw.totalNanoAiu === "number" ? raw.totalNanoAiu : null;
  const aiCredits = nano === null ? null : nano / NANO;
  const status = typeof raw.aiCreditsStatus === "string" ? raw.aiCreditsStatus : null;

  return {
    usage: {
      inputTokens,
      outputTokens,
      ...(cacheRead > 0 ? { cachedInputTokens: cacheRead } : {}),
    },
    costUsd: aiCredits !== null && status === "complete" ? round(aiCredits * USD_PER_AI_CREDIT) : null,
    aiCredits,
    aiCreditsStatus: status,
    premiumRequests: asNumber(raw.totalPremiumRequestCost, 0),
    model: topModel?.name ?? null,
    totalApiDurationMs: asNumber(raw.totalApiDurationMs, 0),
    raw,
  };
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export async function readCopilotUsageFile(filePath: string): Promise<CopilotUsageFile | null> {
  try {
    return parseCopilotUsageFile(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}
