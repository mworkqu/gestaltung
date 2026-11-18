import { createHash } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CODE_LIBRARY } from "@/lib/studio/library";
import { EXAMPLE_BUILD_FILE } from "../build-file";
import type { PluginProduct } from "../check-project";
import { pluginLibraryFrom } from "../to-studio";
import { corsPreflight, MCP_CORS_HEADERS, withCors } from "./cors";
import {
  PluginNotSetUpError,
  rateKey,
  registerPluginServer,
  SERVER_INFO,
  SERVER_INSTRUCTIONS,
  sourceFromName,
  TEXT_FAILED,
  TEXT_NOT_SET_UP,
  TEXT_RATE_LIMITED,
  type HandoffInsert,
  type LeadInsert,
  type OwnerMail,
  type PluginServerDeps,
} from "./register";

const lib = pluginLibraryFrom(CODE_LIBRARY);
const skuOf = (id: string) => CODE_LIBRARY.getPart(id)!.storeSkus[0];
const PRODUCTS = new Map<string, PluginProduct>([
  [skuOf("soil_moisture_cap"), { sku: skuOf("soil_moisture_cap"), name: "Soil sensor", name_ar: null, unit_price: 12.5 }],
  [skuOf("pump_5v"), { sku: skuOf("pump_5v"), name: "Pump", name_ar: null, unit_price: 20 }],
]);

type Captured = { handoffs: HandoffInsert[]; leads: LeadInsert[]; links: [string, string][]; mails: OwnerMail[]; rateKeys: string[] };

function fakeDeps(over: Partial<PluginServerDeps> = {}): { deps: PluginServerDeps; cap: Captured } {
  const cap: Captured = { handoffs: [], leads: [], links: [], mails: [], rateKeys: [] };
  const deps: PluginServerDeps = {
    loadLibrary: async () => lib,
    loadProducts: async (skus) => new Map([...PRODUCTS].filter(([k]) => skus.includes(k))),
    searchParts: async (q, _c, limit, locale) =>
      Array.from({ length: 20 }, (_, i) => ({
        sku: `SKU-${i}`,
        name: `${q} ${i}`,
        name_ar: null,
        price_qar: 10,
        pack_size: 1,
        lead_time_class: "in_stock",
        arrives_by: "2026-11-25",
        url: `https://example.test/${locale}/store/SKU-${i}`,
      })).slice(0, limit),
    minWallMm: async () => 1.2,
    ipHash: () => null,
    rateHit: async (key) => {
      cap.rateKeys.push(key);
      return true;
    },
    storeHandoff: async (row) => {
      cap.handoffs.push(row);
      return { id: "handoff-1" };
    },
    createLead: async (row) => {
      cap.leads.push(row);
      return { id: "lead-1" };
    },
    linkLead: async (a, b) => {
      cap.links.push([a, b]);
    },
    sendOwnerEmail: async (mail) => {
      cap.mails.push(mail);
      return true;
    },
    siteUrl: "https://gestaltung360.com",
    now: () => new Date("2026-11-18T10:30:00Z"),
    ...over,
  };
  return { deps, cap };
}

let client: Client | null = null;

async function connect(deps: PluginServerDeps): Promise<Client> {
  const server = new McpServer({ ...SERVER_INFO }, { instructions: SERVER_INSTRUCTIONS });
  registerPluginServer(server, deps);
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "claude-ai", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

type ToolResult = { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown> };
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) =>
  (await c.callTool({ name, arguments: args })) as unknown as ToolResult;
const firstText = (r: ToolResult) => r.content[0]?.text ?? "";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await client?.close();
  client = null;
  vi.restoreAllMocks();
});

function propertyNames(schema: unknown, out: string[] = []): string[] {
  if (!schema || typeof schema !== "object") return out;
  const s = schema as Record<string, unknown>;
  if (s.properties && typeof s.properties === "object") {
    for (const [k, v] of Object.entries(s.properties as Record<string, unknown>)) {
      out.push(k);
      propertyNames(v, out);
    }
  }
  for (const key of ["items", "anyOf", "oneOf", "allOf", "additionalProperties"]) {
    const v = s[key];
    if (Array.isArray(v)) v.forEach((x) => propertyNames(x, out));
    else if (v && typeof v === "object") propertyNames(v, out);
  }
  return out;
}

describe("plugin MCP server", () => {
  it("lists exactly the four tools with the right annotations and no chat-shaped inputs", async () => {
    const c = await connect(fakeDeps().deps);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["check_project", "get_design_rules", "search_parts", "send_project"]);
    for (const t of tools) {
      if (t.name === "send_project") {
        expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false });
        expect(t.description).toContain("Only call this after the user has explicitly agreed to send it");
        expect(t.description).toContain("The chat itself is never sent.");
      } else {
        expect(t.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
      }
      const names = propertyNames(t.inputSchema);
      for (const n of names) expect(n).not.toMatch(/conversation|transcript|chat|history|messages/i);
    }
    const check = tools.find((t) => t.name === "check_project")!;
    expect(propertyNames(check.inputSchema)).toEqual(expect.arrayContaining(["build", "summary", "parts", "library_id", "cad"]));
  });

  it("sends short English instructions, the resource and the prompt", async () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThan(1500);
    const c = await connect(fakeDeps().deps);
    expect(c.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    expect(SERVER_INSTRUCTIONS).toMatch(/explicit agreement/);
    expect(SERVER_INSTRUCTIONS).not.toMatch(/SolidWorks|Fusion|OpenSCAD|FreeCAD|CadQuery/i);

    const { resources } = await c.listResources();
    expect(resources.map((r) => r.uri)).toContain("gestaltung://design-rules");
    const res = await c.readResource({ uri: "gestaltung://design-rules" });
    expect((res.contents[0] as { text: string }).text).toContain("# Gestaltung360 design rules");

    const { prompts } = await c.listPrompts();
    expect(prompts.map((p) => p.name)).toContain("design_a_product");
    const p = await c.getPrompt({ name: "design_a_product" });
    const text = (p.messages[0].content as { text: string }).text;
    expect(text).toMatch(/explicit agreement/);
    expect(text).toContain("Our engineer reviews your file and quotes the best method within one working day.");
  });

  it("get_design_rules returns the parts", async () => {
    const c = await connect(fakeDeps().deps);
    const r = await call(c, "get_design_rules");
    expect(r.isError).toBeFalsy();
    const parts = r.structuredContent?.parts as { id: string }[];
    expect(parts.length).toBeGreaterThan(5);
    expect(parts.map((p) => p.id)).toContain("esp32_c3_mini");
  });

  it("search_parts caps the result and summarises it", async () => {
    const c = await connect(fakeDeps().deps);
    const r = await call(c, "search_parts", { query: "relay", limit: 3 });
    expect(firstText(r)).toBe("Found 3 parts for 'relay'.");
    expect((r.structuredContent?.parts as unknown[]).length).toBe(3);
  });

  it("check_project: the example is ready with a QAR total; an unknown part is a problem", async () => {
    const c = await connect(fakeDeps().deps);
    const ok = await call(c, "check_project", { build: EXAMPLE_BUILD_FILE });
    expect(ok.isError).toBeFalsy();
    expect(firstText(ok)).toBe("Ready to send.");
    expect(ok.structuredContent).toMatchObject({ ok: true });
    expect(typeof ok.structuredContent?.parts_total_qar).toBe("number");
    expect(ok.structuredContent).not.toHaveProperty("doc");

    const bad = {
      ...EXAMPLE_BUILD_FILE,
      parts: [...EXAMPLE_BUILD_FILE.parts, { library_id: "flux_capacitor", qty: 1 }],
    };
    const r = await call(c, "check_project", { build: bad });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.ok).toBe(false);
    expect((r.structuredContent?.problems as string[]).length).toBeGreaterThan(0);
    expect(firstText(r)).toMatch(/^\d+ problems? to fix before sending\.$/);
  });

  it("check_project: a schema-invalid build comes back as a readable tool error, not a protocol error", async () => {
    const c = await connect(fakeDeps().deps);
    const r = await call(c, "check_project", { build: { ...EXAMPLE_BUILD_FILE, name: "x" } });
    expect(r.isError).toBe(true);
    expect(firstText(r)).toMatch(/Input validation error/);
    expect(firstText(r)).toMatch(/name/);
  });

  it("send_project stores only the token hash, writes the lead and emails the owner", async () => {
    const { deps, cap } = fakeDeps();
    const c = await connect(deps);
    const r = await call(c, "send_project", {
      build: EXAMPLE_BUILD_FILE,
      contact: { name: "Mona", phone: "5555 1234", email: "mona@example.com" },
      locale: "en",
    });
    expect(r.isError).toBeFalsy();
    const link = r.structuredContent?.link as string;
    expect(link).toMatch(/\/en\/handoff\/[A-Za-z0-9_-]{43}$/);
    expect(firstText(r)).toBe(`Sent. Open your project: ${link}`);
    expect(r.structuredContent?.expires_at).toBe("2026-12-18T10:30:00.000Z");

    const token = link.split("/").pop()!;
    expect(cap.handoffs).toHaveLength(1);
    expect(cap.handoffs[0].token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(cap.handoffs[0].source).toBe("claude");
    expect(cap.handoffs[0].contact_phone).toBe("+97455551234");
    expect(cap.handoffs[0].studio_doc).toBeTruthy();
    // The token itself is never handed to any dependency.
    expect(JSON.stringify(cap)).not.toContain(token);

    expect(cap.leads).toHaveLength(1);
    expect(cap.leads[0].message.startsWith("Plugin project: Balcony plant waterer\n")).toBe(true);
    expect(cap.leads[0].message).toMatch(/Parts total: QAR \d+\.\d{2}/);
    expect(cap.leads[0].message).toContain("Admin: https://gestaltung360.com/en/dashboard/leads");
    expect(cap.links).toEqual([["handoff-1", "lead-1"]]);

    expect(cap.mails).toHaveLength(1);
    expect(cap.mails[0].subject).toBe("New project from Claude — Balcony plant waterer");
    expect(cap.mails[0].text).toContain("Stake-shaped case");
    expect(cap.mails[0].html).toContain("/en/dashboard/leads");
  });

  it("send_project refuses a wrong phone and an unchecked build without storing anything", async () => {
    const { deps, cap } = fakeDeps();
    const c = await connect(deps);
    const phone = await call(c, "send_project", { build: EXAMPLE_BUILD_FILE, contact: { phone: "123" } });
    expect(phone.isError).toBeFalsy();
    expect(phone.structuredContent?.ok).toBe(false);
    expect((phone.structuredContent?.problems as string[])[0]).toMatch(/phone number looks wrong/);

    const bad = { ...EXAMPLE_BUILD_FILE, parts: [{ library_id: "flux_capacitor", qty: 1 }] };
    const r = await call(c, "send_project", { build: bad });
    expect(r.structuredContent?.ok).toBe(false);
    expect(cap.handoffs).toHaveLength(0);
    expect(cap.leads).toHaveLength(0);
  });

  it("send_project still answers with the link when the email or lead fails", async () => {
    const { deps } = fakeDeps({
      sendOwnerEmail: async () => {
        throw new Error("resend down");
      },
      createLead: async () => {
        throw new Error("insert failed");
      },
    });
    const c = await connect(deps);
    const r = await call(c, "send_project", { build: EXAMPLE_BUILD_FILE });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.link).toMatch(/\/handoff\//);
  });

  it("send_project before 0112 says sending is being set up", async () => {
    const { deps } = fakeDeps({
      storeHandoff: async () => {
        throw new PluginNotSetUpError();
      },
    });
    const c = await connect(deps);
    const r = await call(c, "send_project", { build: EXAMPLE_BUILD_FILE });
    expect(r.isError).toBe(true);
    expect(firstText(r)).toBe(TEXT_NOT_SET_UP);
  });

  it("answers over the limit with the rate-limit text", async () => {
    const { deps } = fakeDeps({ rateHit: async () => false });
    const c = await connect(deps);
    for (const [name, args] of [
      ["get_design_rules", {}],
      ["search_parts", { query: "led" }],
      ["check_project", { build: EXAMPLE_BUILD_FILE }],
      ["send_project", { build: EXAMPLE_BUILD_FILE }],
    ] as const) {
      const r = await call(c, name, args);
      expect(r.isError).toBe(true);
      expect(firstText(r)).toBe(TEXT_RATE_LIMITED);
    }
  });

  it("never exposes an unexpected error's message or stack", async () => {
    const { deps } = fakeDeps({
      loadLibrary: async () => {
        throw new Error("password=hunter2 at db.internal:5432");
      },
    });
    const c = await connect(deps);
    const r = await call(c, "check_project", { build: EXAMPLE_BUILD_FILE });
    expect(r.isError).toBe(true);
    expect(firstText(r)).toBe(TEXT_FAILED);
    expect(JSON.stringify(r)).not.toMatch(/hunter2|db\.internal|at /);
  });

  it("keys the rate windows on the Qatar hour / day and 'noip'", async () => {
    const { deps, cap } = fakeDeps();
    const c = await connect(deps);
    await call(c, "get_design_rules");
    await call(c, "check_project", { build: EXAMPLE_BUILD_FILE });
    expect(cap.rateKeys).toEqual(["mcp:read:noip:2026111813", "mcp:check:noip:2026111813"]);
    expect(rateKey("send", "abc", new Date("2026-11-18T22:00:00Z"))).toBe("mcp:send:abc:20261119");
  });
});

describe("helpers", () => {
  it("maps client names to a source", () => {
    expect(sourceFromName("claude-ai")).toBe("claude");
    expect(sourceFromName("OpenAI-MCP")).toBe("chatgpt");
    expect(sourceFromName("ChatGPT")).toBe("chatgpt");
    expect(sourceFromName("node")).toBe("other");
    expect(sourceFromName(undefined)).toBe("other");
  });

  it("adds CORS headers and answers the preflight with 204", async () => {
    const pre = corsPreflight();
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
    const wrapped = withCors(async () => new Response("x", { status: 405, headers: { "content-type": "text/plain" } }));
    const res = await wrapped(new Request("https://x.test/api/mcp"));
    expect(res.status).toBe(405);
    expect(res.headers.get("content-type")).toBe("text/plain");
    for (const [k, v] of Object.entries(MCP_CORS_HEADERS)) expect(res.headers.get(k)).toBe(v);
    expect(res.headers.get("access-control-expose-headers")).toBe("mcp-session-id");
  });
});
