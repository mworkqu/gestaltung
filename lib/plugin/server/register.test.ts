import { createHash } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_MEETING_SETTINGS } from "@/lib/meetings/settings";
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
  type MeetingBookRequest,
  type OwnerMail,
  type PluginServerDeps,
} from "./register";

const lib = pluginLibraryFrom(CODE_LIBRARY);
const skuOf = (id: string) => CODE_LIBRARY.getPart(id)!.storeSkus[0];
const PRODUCTS = new Map<string, PluginProduct>([
  [skuOf("soil_moisture_cap"), { sku: skuOf("soil_moisture_cap"), name: "Soil sensor", name_ar: null, unit_price: 12.5 }],
  [skuOf("pump_5v"), { sku: skuOf("pump_5v"), name: "Pump", name_ar: null, unit_price: 20 }],
]);

type Captured = {
  handoffs: HandoffInsert[];
  leads: LeadInsert[];
  links: [string, string][];
  mails: OwnerMail[];
  clientMails: { to: string; mail: OwnerMail }[];
  rateKeys: string[];
  books: MeetingBookRequest[];
};

/** The free slots the fake offers: Monday 23 and Wednesday 25 November 2026, 16:00 Qatar. */
const SLOT_MON = "2026-11-23T13:00:00.000Z";
const SLOT_WED = "2026-11-25T13:00:00.000Z";

function fakeDeps(over: Partial<PluginServerDeps> = {}): { deps: PluginServerDeps; cap: Captured } {
  const cap: Captured = { handoffs: [], leads: [], links: [], mails: [], clientMails: [], rateKeys: [], books: [] };
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
    sendClientEmail: async (to, mail) => {
      cap.clientMails.push({ to, mail });
      return true;
    },
    meetingSettings: async () => DEFAULT_MEETING_SETTINGS,
    freeMeetingSlots: async () => [SLOT_MON, SLOT_WED],
    bookMeeting: async (req) => {
      cap.books.push(req);
      return {
        ok: true,
        startsAt: req.startsAt,
        mode: req.mode,
        manageUrl: `https://gestaltung360.com/${req.locale}/meetings/tok-test`,
        invoiceQar: 150,
      };
    },
    handoffIdForToken: async (token) => (token ? "handoff-1" : null),
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
  it("lists exactly the seven tools with the right annotations and no chat-shaped inputs", async () => {
    const c = await connect(fakeDeps().deps);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "book_meeting",
      "check_project",
      "get_design_rules",
      "list_meeting_slots",
      "preview_look",
      "search_parts",
      "send_project",
    ]);
    // Every writing tool says it is only called after the user agrees.
    const WRITERS = ["send_project", "book_meeting"];
    for (const t of tools) {
      if (WRITERS.includes(t.name)) {
        expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false });
        expect(t.description).toMatch(/[Oo]nly call this after the user has explicitly agreed/);
      } else {
        expect(t.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
      }
      if (t.name === "send_project") expect(t.description).toContain("The chat itself is never sent.");
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

  // ── meetings (Phase 2) ─────────────────────────────────────────────────────

  it("lists free meeting slots with both labels, the price and the three rules", async () => {
    const { deps, cap } = fakeDeps();
    const c = await connect(deps);
    const r = await call(c, "list_meeting_slots", { days: 21, locale: "en" });
    const data = r.structuredContent as {
      slots: { starts_at: string; label_en: string; label_ar: string }[];
      price_qar: number;
      lines: string[];
      modes: { mode: string; label: string; detail: string }[];
      company: string;
    };

    expect(r.isError).toBeFalsy();
    expect(data.slots).toHaveLength(2);
    expect(data.slots[0]!.starts_at).toBe(SLOT_MON);
    expect(data.slots[0]!.label_en).toMatch(/Mon 23 Nov/);
    expect(data.slots[0]!.label_ar).toContain("نوفمبر");
    // Western digits in Arabic
    expect(data.slots[0]!.label_ar).not.toMatch(/[٠-٩۰-۹]/);

    expect(data.price_qar).toBe(150);
    expect(data.lines[0]).toMatch(/1 hour/);
    expect(data.lines[0]).toMatch(/QAR\s*150/);
    expect(data.lines[1]).toMatch(/only if you are happy/i);
    expect(data.lines[2]).toMatch(/24 hours before/);
    expect(data.lines[2]).toMatch(/within 30 days/);
    // the company's legal name and C.R. go on anything that books
    expect(data.company).toContain("Gestaltung for Trading and Services W.L.L");
    expect(data.company).toContain("236988");
    // no CAD program, no "free" offer
    expect(JSON.stringify(data)).not.toMatch(/SolidWorks|Fusion|OpenSCAD|FreeCAD/i);
    expect(data.modes.map((m) => m.mode)).toEqual(["online", "studio"]);
    expect(data.modes[0]!.detail).toMatch(/WhatsApp/);
    expect(data.modes[1]!.detail).toMatch(/Lusail/);

    // read bucket, hourly window
    expect(cap.rateKeys.some((k) => k.startsWith("mcp:read:"))).toBe(true);
  });

  it("books a meeting, writes the lead, e-mails the owner and the client, and returns the manage link", async () => {
    const { deps, cap } = fakeDeps();
    const c = await connect(deps);
    const r = await call(c, "book_meeting", {
      starts_at: SLOT_MON,
      mode: "online",
      name: "Noora",
      phone: "+974 5555 1234",
      email: "noora@example.com",
      topic: "I want to talk about the pump",
      locale: "en",
    });
    const data = r.structuredContent as Record<string, unknown>;

    expect(r.isError).toBeFalsy();
    expect(data.ok).toBe(true);
    expect(data.price_qar).toBe(150);
    expect(data.manage_link).toBe("https://gestaltung360.com/en/meetings/tok-test");
    expect(firstText(r)).toMatch(/Booked:/);
    expect(data.company).toContain("236988");

    // the phone reached the booking as E.164
    expect(cap.books).toHaveLength(1);
    expect(cap.books[0]).toMatchObject({ phone: "+97455551234", mode: "online", startsAt: SLOT_MON, handoffId: null });
    // 0114: which chat booked it travels with the booking. This test's client
    // announces itself as "claude-ai" in the handshake, so it reads as "claude"
    // — the same path a real Claude connector takes.
    expect(cap.books[0]!.chatSource).toBe("claude");

    // the lead is keyed for lib/admin/lead-kind.ts
    expect(cap.leads).toHaveLength(1);
    expect(cap.leads[0]!.message.startsWith("Meeting booked:")).toBe(true);
    expect(cap.leads[0]!.phone).toBe("+97455551234");

    // owner e-mail names the person and the time; the client gets their own
    expect(cap.mails).toHaveLength(1);
    expect(cap.mails[0]!.subject).toMatch(/^New meeting booked — Noora · Mon 23 Nov/);
    expect(cap.clientMails).toHaveLength(1);
    expect(cap.clientMails[0]!.to).toBe("noora@example.com");
    expect(cap.clientMails[0]!.mail.subject).toMatch(/Your meeting is booked/);
    // the IBAN never goes in a booking e-mail
    expect(cap.mails[0]!.html + cap.clientMails[0]!.mail.html).not.toContain("QA94");

    // daily bucket for bookings
    expect(cap.rateKeys.some((k) => /^mcp:meeting:noip:\d{8}$/.test(k))).toBe(true);
  });

  it("sends no e-mail to a client who gave no address", async () => {
    const { deps, cap } = fakeDeps();
    const c = await connect(deps);
    await call(c, "book_meeting", { starts_at: SLOT_MON, mode: "studio", name: "Ali", phone: "+97455551234", locale: "ar" });
    expect(cap.books).toHaveLength(1);
    expect(cap.clientMails).toHaveLength(0);
    expect(cap.mails).toHaveLength(1);
  });

  it("refuses a bad phone and a bad time without booking anything", async () => {
    const { deps, cap } = fakeDeps();
    const c = await connect(deps);

    const badPhone = await call(c, "book_meeting", { starts_at: SLOT_MON, mode: "online", name: "X", phone: "12345678", locale: "en" });
    expect((badPhone.structuredContent as { ok: boolean }).ok).toBe(false);
    expect(firstText(badPhone)).toMatch(/phone number looks wrong/);

    const badTime = await call(c, "book_meeting", { starts_at: "not-a-time!!", mode: "online", name: "X", phone: "+97455551234", locale: "en" });
    expect((badTime.structuredContent as { ok: boolean }).ok).toBe(false);

    const badEmail = await call(c, "book_meeting", {
      starts_at: SLOT_MON,
      mode: "online",
      name: "X",
      phone: "+97455551234",
      email: "nope",
      locale: "en",
    });
    expect((badEmail.structuredContent as { ok: boolean }).ok).toBe(false);

    expect(cap.books).toHaveLength(0);
    expect(cap.leads).toHaveLength(0);
    expect(cap.mails).toHaveLength(0);
  });

  it("links a hand-off only from one of our own links", async () => {
    const { deps, cap } = fakeDeps();
    const c = await connect(deps);
    const token = "a".repeat(40);

    await call(c, "book_meeting", {
      starts_at: SLOT_MON,
      mode: "online",
      name: "Noora",
      phone: "+97455551234",
      handoff_link: `https://gestaltung360.com/en/handoff/${token}`,
      locale: "en",
    });
    expect(cap.books[0]!.handoffId).toBe("handoff-1");

    // a foreign host is ignored, never fetched
    await call(c, "book_meeting", {
      starts_at: SLOT_WED,
      mode: "online",
      name: "Noora",
      phone: "+97455551234",
      handoff_link: `https://evil.test/en/handoff/${token}`,
      locale: "en",
    });
    expect(cap.books[1]!.handoffId).toBe(null);
  });

  it("passes a refused slot back as words the model can act on", async () => {
    const { deps, cap } = fakeDeps({ bookMeeting: async () => ({ ok: false, error: "slot_taken" }) });
    const c = await connect(deps);
    const r = await call(c, "book_meeting", { starts_at: SLOT_MON, mode: "online", name: "X", phone: "+97455551234", locale: "en" });

    expect((r.structuredContent as { ok: boolean }).ok).toBe(false);
    expect(firstText(r)).toMatch(/just been taken/);
    expect(firstText(r)).toMatch(/list_meeting_slots/);
    expect(cap.leads).toHaveLength(0);
    expect(cap.mails).toHaveLength(0);
  });

  it("says 'not set up yet' before the migration runs, with no stack trace", async () => {
    const { deps } = fakeDeps({ bookMeeting: async () => ({ ok: false, error: "not_set_up" }) });
    const c = await connect(deps);
    const r = await call(c, "book_meeting", { starts_at: SLOT_MON, mode: "online", name: "X", phone: "+97455551234", locale: "en" });

    expect(r.isError).toBe(true);
    expect(firstText(r)).toBe(TEXT_NOT_SET_UP);
    expect(firstText(r)).not.toMatch(/at .*\.ts:\d+|Error:/);
  });

  it("tells the client's AI to offer a meeting only with explicit agreement", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/list_meeting_slots/);
    expect(SERVER_INSTRUCTIONS).toMatch(/only after the user explicitly agrees/);
    expect(SERVER_INSTRUCTIONS.length).toBeLessThan(1500);
  });

  // ── how it will look (Phase 3) ─────────────────────────────────────────────

  it("previews the look with the parts, the total and what would be sent", async () => {
    const c = await connect(fakeDeps().deps);
    const r = await call(c, "preview_look", { build: EXAMPLE_BUILD_FILE, locale: "en" });
    const data = r.structuredContent as {
      name: string;
      look: { template: string; shape: string; colour: string; finish: string; swatch: string };
      parts: { name: string; qty: number; price: string | null }[];
      parts_total: string;
      sends: string[];
      engineer_line: string;
      company: string;
      build: unknown;
    };

    expect(r.isError).toBeFalsy();
    expect(data.name).toBe(EXAMPLE_BUILD_FILE.name);
    expect(data.parts.length).toBeGreaterThan(0);
    expect(data.parts_total).toMatch(/QAR/);
    expect(data.company).toContain("236988");
    expect(data.engineer_line).toMatch(/within one working day/);
    // the look is described in plain words, never by our template id
    expect(data.look.shape).not.toMatch(/_/);
    expect(data.look.swatch).toMatch(/^#[0-9a-f]{6}$/i);

    // the list the user reads before agreeing, and the promise we never send the chat
    expect(data.sends.some((s) => /never sent/i.test(s))).toBe(true);
    // the build rides along so the card's Send button can call send_project
    expect(data.build).toBeTruthy();

    // a host with no card support gets the same facts as text
    expect(firstText(r)).toMatch(/Parts total: QAR/);
    expect(firstText(r)).toContain(EXAMPLE_BUILD_FILE.name);

    // house rules: no CAD program and no "free" anywhere in what the user reads
    const all = JSON.stringify(data) + firstText(r);
    expect(all).not.toMatch(/SolidWorks|Fusion|OpenSCAD|FreeCAD|CadQuery/i);
    expect(all).not.toMatch(/\bfree\b/i);

    // We quote NO case dimension of our own: the engineer models it. A part's
    // own name and the user's case notes may of course mention a size.
    expect(Object.keys(data.look).join(" ")).not.toMatch(/width|depth|height|mm|size/i);
    expect(`${data.look.shape} ${data.look.colour} ${data.look.finish}`).not.toMatch(/\d/);
  });

  it("refuses to preview a project that does not pass the checks", async () => {
    const { deps, cap } = fakeDeps();
    const c = await connect(deps);
    const bad = { ...EXAMPLE_BUILD_FILE, parts: [{ library_id: "not_a_real_part", qty: 1 }] };
    const r = await call(c, "preview_look", { build: bad, locale: "en" });

    expect((r.structuredContent as { ok: boolean }).ok).toBe(false);
    expect(firstText(r)).toMatch(/Not ready to show/);
    // a preview writes nothing, ever
    expect(cap.handoffs).toHaveLength(0);
    expect(cap.leads).toHaveLength(0);
  });

  it("points the tool at its UI resource for both hosts", async () => {
    const c = await connect(fakeDeps().deps);
    const { tools } = await c.listTools();
    const preview = tools.find((t) => t.name === "preview_look")!;
    const meta = preview._meta as { ui?: { resourceUri?: string }; "openai/outputTemplate"?: string };

    expect(meta.ui?.resourceUri).toBe("ui://gestaltung360/preview");
    // ChatGPT's alias for the same resource, so one server serves both
    expect(meta["openai/outputTemplate"]).toBe("ui://gestaltung360/preview");
    expect(preview.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  });

  it("serves the widget as an MCP Apps HTML resource", async () => {
    const c = await connect(fakeDeps().deps);
    const { resources } = await c.listResources();
    expect(resources.map((r) => r.uri)).toContain("ui://gestaltung360/preview");

    const res = await c.readResource({ uri: "ui://gestaltung360/preview" });
    const first = res.contents[0] as { mimeType: string; text: string; _meta?: { ui?: { csp?: { resourceDomains?: string[] } } } };

    // the one mime type the MCP Apps spec allows for an HTML widget
    expect(first.mimeType).toBe("text/html;profile=mcp-app");
    expect(first.text.startsWith("<!doctype html>")).toBe(true);
    // self-contained: no external script or stylesheet is fetched at render time
    expect(first.text).not.toMatch(/<script[^>]+src=/i);
    expect(first.text).not.toMatch(/<link[^>]+stylesheet/i);
    // the CDN is declared for a lazy engine, but nothing loads from it today
    expect(first._meta?.ui?.csp?.resourceDomains).toEqual(["https://cdn.jsdelivr.net"]);
    // it talks to the host through the spec's bridge, with ChatGPT's as a fallback
    expect(first.text).toContain("ui/notifications/tool-result");
    expect(first.text).toContain("tools/call");
    expect(first.text).toContain("window.openai");
    // and it names no CAD program
    expect(first.text).not.toMatch(/SolidWorks|Fusion|OpenSCAD|FreeCAD|CadQuery/i);
    // comfortably inside the 300 kB budget
    expect(first.text.length).toBeLessThan(300_000);
  });
});
