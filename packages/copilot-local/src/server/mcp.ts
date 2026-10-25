import type { AdapterRuntimeMcpServer } from "@paperclipai/adapter-utils";
import { asString, parseObject } from "@paperclipai/adapter-utils/server-utils";

export function sanitizeMcpServerName(name: string, taken: Set<string>): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "mcp";
  let candidate = base;
  for (let i = 2; taken.has(candidate); i += 1) candidate = `${base}-${i}`;
  taken.add(candidate);
  return candidate;
}

/**
 * Build the JSON document for `copilot --additional-mcp-config @<file>`.
 * The host hands out per-run bearer tokens; they must never go on the command
 * line, so callers write this to a 0600 temp file and pass `@path`.
 */
export function buildCopilotMcpConfig(servers: readonly AdapterRuntimeMcpServer[]): {
  config: { mcpServers: Record<string, { type: "http"; url: string; headers: Record<string, string>; tools: string[] }> };
  names: string[];
} {
  const taken = new Set<string>();
  const mcpServers: Record<string, { type: "http"; url: string; headers: Record<string, string>; tools: string[] }> = {};
  for (const server of servers) {
    if (!server.url || !server.token) continue;
    const name = sanitizeMcpServerName(server.name, taken);
    mcpServers[name] = {
      type: "http",
      url: server.url,
      headers: { Authorization: `Bearer ${server.token}` },
      tools: ["*"],
    };
  }
  return { config: { mcpServers }, names: Object.keys(mcpServers) };
}

/**
 * Managed MCP gateways the host places in `context.paperclipManagedMcp`
 * (only when `managedMcpOnly` is true). Gateway paths are relative to the
 * Paperclip API base URL.
 */
export function managedGatewayServers(
  context: Record<string, unknown>,
  apiBaseUrl: string,
): AdapterRuntimeMcpServer[] {
  const managed = parseObject(context.paperclipManagedMcp);
  if (managed.managedMcpOnly !== true || !Array.isArray(managed.gateways)) return [];
  const servers: AdapterRuntimeMcpServer[] = [];
  for (const raw of managed.gateways) {
    const gateway = parseObject(raw);
    const name = asString(gateway.name, "").trim();
    const endpointPath = asString(gateway.endpointPath, "").trim();
    const token = asString(gateway.bearerToken, "").trim();
    if (!name || !endpointPath || !token) continue;
    const url = /^https?:\/\//i.test(endpointPath)
      ? endpointPath
      : `${apiBaseUrl.replace(/\/+$/, "")}/${endpointPath.replace(/^\/+/, "")}`;
    servers.push({ name, url, token, connectionId: asString(gateway.id, name) });
  }
  return servers;
}

export function mergeMcpServers(
  ...lists: ReadonlyArray<readonly AdapterRuntimeMcpServer[]>
): AdapterRuntimeMcpServer[] {
  const seen = new Set<string>();
  const merged: AdapterRuntimeMcpServer[] = [];
  for (const list of lists) {
    for (const server of list) {
      if (seen.has(server.url)) continue;
      seen.add(server.url);
      merged.push(server);
    }
  }
  return merged;
}
