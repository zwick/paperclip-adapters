import { describe, expect, it } from "vitest";
import { buildCopilotMcpConfig, managedGatewayServers, mergeMcpServers, sanitizeMcpServerName } from "../src/server/mcp.js";

const server = (name: string, url = `https://x/${name}`) => ({ name, url, token: `tok-${name}`, connectionId: name });

describe("buildCopilotMcpConfig", () => {
  it("emits http servers with bearer headers and sanitized unique names", () => {
    const { config, names } = buildCopilotMcpConfig([
      server("Paperclip connections"),
      server("Paperclip projects"),
      server("Paperclip Projects", "https://x/other"),
    ]);
    expect(names).toEqual(["paperclip-connections", "paperclip-projects", "paperclip-projects-2"]);
    expect(config.mcpServers["paperclip-connections"]).toEqual({
      type: "http",
      url: "https://x/Paperclip connections",
      headers: { Authorization: "Bearer tok-Paperclip connections" },
      tools: ["*"],
    });
  });

  it("skips servers without url or token", () => {
    const { names } = buildCopilotMcpConfig([{ name: "a", url: "", token: "t", connectionId: "a" }, { name: "b", url: "u", token: "", connectionId: "b" }]);
    expect(names).toEqual([]);
  });

  it("sanitizes odd names", () => {
    expect(sanitizeMcpServerName("  !!  ", new Set())).toBe("mcp");
  });
});

describe("managed gateways", () => {
  it("resolves relative gateway paths against the API base and ignores non-managed-only context", () => {
    const ctx = { paperclipManagedMcp: { managedMcpOnly: true, gateways: [{ id: "g1", name: "GH", endpointPath: "/mcp/gateways/abc", bearerToken: "bt" }] } };
    expect(managedGatewayServers(ctx, "http://127.0.0.1:3100/")).toEqual([
      { name: "GH", url: "http://127.0.0.1:3100/mcp/gateways/abc", token: "bt", connectionId: "g1" },
    ]);
    expect(managedGatewayServers({ paperclipManagedMcp: { managedMcpOnly: false, gateways: ctx.paperclipManagedMcp.gateways } }, "http://x")).toEqual([]);
  });

  it("dedupes by url when merging", () => {
    expect(mergeMcpServers([server("a")], [server("b", "https://x/a")])).toHaveLength(1);
  });
});
