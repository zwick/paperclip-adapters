#!/usr/bin/env node
// Loads the packaged adapter through the HOST's own plugin loader and registry store, against an ISOLATED Paperclip home.
// Usage: PAPERCLIP_HOME=<tmp> PAPERCLIP_INSTANCE_ID=iso node scripts/verify-host-load.mjs <unpacked-package-dir> [host-server-dist]
import path from "node:path";
import { pathToFileURL } from "node:url";

const pkgDir = path.resolve(process.argv[2] ?? ".");
const hostDist = process.argv[3] ?? "/Users/zwick/.paperclip/cli/current/node_modules/@paperclipai/server/dist";
if (!process.env.PAPERCLIP_HOME) throw new Error("Refusing to run without an isolated PAPERCLIP_HOME");
const imp = (p) => import(pathToFileURL(path.join(hostDist, p)).href);

const loader = await imp("adapters/plugin-loader.js");
const store = await imp("services/adapter-plugin-store.js");
const name = "@zwicker-software/copilot-paperclip-adapter";

const mod = await loader.loadExternalAdapterPackage(name, pkgDir);
console.log("loaded type:", mod.type, "| runtimeToolDelivery:", mod.runtimeToolDelivery, "| supportsLocalAgentJwt:", mod.supportsLocalAgentJwt);
console.log("has execute/testEnvironment/listSkills/syncSkills/sessionCodec/listModels:", ["execute", "testEnvironment", "listSkills", "syncSkills", "sessionCodec", "listModels"].map((k) => !!mod[k]).join(","));

store.addAdapterPlugin({ packageName: name, localPath: pkgDir, version: "0.3.0", type: mod.type, installedAt: new Date().toISOString() });
console.log("registry path:", store.getAdapterPluginsDir(), "| records:", JSON.stringify(store.listAdapterPlugins?.() ?? "n/a"));
const built = await loader.buildExternalAdapters();
console.log("buildExternalAdapters ->", built.map((a) => a.type).join(","));

const env = await mod.testEnvironment({ companyId: "c", adapterType: "copilot_local", config: { command: "copilot", cwd: process.cwd() } });
console.log("testEnvironment:", env.status, env.checks.map((c) => `${c.level}:${c.code}`).join(" "));
const skills = await mod.listSkills({ agentId: "a", companyId: "c", adapterType: "copilot_local", config: {} });
console.log("listSkills ok:", Array.isArray(skills.entries), "mode:", skills.mode);
