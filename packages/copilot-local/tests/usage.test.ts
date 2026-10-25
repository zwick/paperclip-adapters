import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCopilotUsageFile } from "../src/server/usage.js";

const fixture = fs.readFileSync(new URL("./fixtures/usage-output-1.0.103.json", import.meta.url), "utf8");

describe("parseCopilotUsageFile", () => {
  it("maps the real 1.0.103 usage file", () => {
    const parsed = parseCopilotUsageFile(fixture)!;
    expect(parsed.usage).toEqual({ inputTokens: 25928, outputTokens: 4 });
    expect(parsed.model).toBe("claude-sonnet-5.5");
    expect(parsed.premiumRequests).toBe(1);
    expect(parsed.aiCredits).toBeCloseTo(6.4858, 4);
    expect(parsed.costUsd).toBeCloseTo(0.064858, 6);
    expect(parsed.aiCreditsStatus).toBe("complete");
  });

  it("reports cache reads and drops cost when credits are incomplete", () => {
    const parsed = parseCopilotUsageFile(
      JSON.stringify({
        totalNanoAiu: 1e9,
        aiCreditsStatus: "partial",
        modelMetrics: { a: { usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 7 } }, b: { usage: { inputTokens: 5, outputTokens: 1 } } },
      }),
    )!;
    expect(parsed.usage).toEqual({ inputTokens: 15, outputTokens: 3, cachedInputTokens: 7 });
    expect(parsed.costUsd).toBeNull();
  });

  it("returns null for junk", () => {
    expect(parseCopilotUsageFile("nope")).toBeNull();
    expect(parseCopilotUsageFile("{}")).toBeNull();
  });
});
