import fs from "node:fs/promises";
import path from "node:path";

function hasValue(env: Record<string, string>, key: string): boolean {
  return typeof env[key] === "string" && env[key].trim().length > 0;
}

export function renderPaperclipEnvNote(env: Record<string, string>): string {
  const keys = Object.keys(env).filter((k) => k.startsWith("PAPERCLIP_")).sort();
  if (keys.length === 0) return "";
  return [
    "Paperclip runtime note:",
    `The following PAPERCLIP_* environment variables are available in this run: ${keys.join(", ")}`,
    "Do not assume these variables are missing without checking your shell environment.",
    "",
    "",
  ].join("\n");
}

export function renderApiAccessNote(env: Record<string, string>): string {
  if (!hasValue(env, "PAPERCLIP_API_URL") || !hasValue(env, "PAPERCLIP_API_KEY")) return "";
  return [
    "Paperclip API access note:",
    "Use the shell tool with curl to make Paperclip API requests.",
    "GET example:",
    `  curl -s -H "Authorization: Bearer $PAPERCLIP_API_KEY" "$PAPERCLIP_API_URL/api/agents/me"`,
    "POST/PATCH example:",
    `  curl -s -X POST -H "Authorization: Bearer $PAPERCLIP_API_KEY" -H 'Content-Type: application/json' -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" -d '{...}' "$PAPERCLIP_API_URL/api/issues/$PAPERCLIP_TASK_ID/checkout"`,
    "When PAPERCLIP_TASK_ID is not set, substitute a real issue id from the current context; never send a placeholder like {id} in the URL.",
    "",
    "",
  ].join("\n");
}

export interface InstructionsLoad {
  prefix: string;
  filePath: string;
  error: string | null;
}

/** Read `instructionsFilePath` and wrap it with the relative-path directive. */
export async function loadInstructions(instructionsFilePath: string): Promise<InstructionsLoad> {
  const filePath = instructionsFilePath.trim();
  if (!filePath) return { prefix: "", filePath: "", error: null };
  try {
    const contents = await fs.readFile(filePath, "utf8");
    const dir = `${path.dirname(filePath)}/`;
    return {
      prefix:
        `${contents}\n\n` +
        `The above agent instructions were loaded from ${filePath}. ` +
        `Resolve any relative file references from ${dir}.\n\n`,
      filePath,
      error: null,
    };
  } catch (err) {
    return { prefix: "", filePath, error: err instanceof Error ? err.message : String(err) };
  }
}
