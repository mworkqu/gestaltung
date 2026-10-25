import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QuoteCalc } from "@/lib/studio/request-summary";

import { parseLead } from "./parse";
import { createLead, leadDelivered, type LeadDeps, type LeadEmail } from "./save";

const PHONE = "+974 5512 3456";
const USER = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "https://example.test";

type Insert = { client: string; table: string; row: Record<string, unknown> };

/** A recording stand-in for the Supabase client: projects reads + inquiries inserts. */
function fakeClient(label: string, log: Insert[], opts: { projectName?: string | null; userId?: string | null; insertError?: { message: string } | null } = {}) {
  const { projectName = "Rover", userId = USER, insertError = null } = opts;
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: projectName === null ? null : { name: projectName }, error: null }) }),
      }),
      insert: async (row: Record<string, unknown>) => {
        log.push({ client: label, table, row });
        return { error: insertError };
      },
    }),
  } as unknown as SupabaseClient;
}

function setup(over: Partial<LeadDeps> & { user?: Parameters<typeof fakeClient>[2]; svc?: Parameters<typeof fakeClient>[2] | null } = {}) {
  const inserts: Insert[] = [];
  const emails: LeadEmail[] = [];
  const calcCalls: unknown[][] = [];
  const calc = { total: 1 } as unknown as QuoteCalc;
  const deps: LeadDeps = {
    userClient: async () => fakeClient("user", inserts, over.user),
    serviceClient: () => (over.svc === null ? null : fakeClient("service", inserts, over.svc)),
    canSave: true,
    sendEmail: async (m) => {
      emails.push(m);
      return true;
    },
    ownerEmail: "owner@example.test",
    buildQuoteCalc: async (_db, id, link) => {
      calcCalls.push([id, link]);
      return calc;
    },
    isMissingQuoteColumn: (e) => /quote_calc/.test(e?.message ?? ""),
    origin: ORIGIN,
    ...over,
  };
  return { deps, inserts, emails, calcCalls, calc };
}

function lead(body: Record<string, unknown>) {
  const r = parseLead({ name: "Sara", phone: PHONE, ...body });
  if (!r.ok) throw new Error(r.code);
  return r.lead;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("createLead - plain leads", () => {
  it("saves once with the RLS client, then emails the owner with the right subject", async () => {
    const t = setup();
    const r = await createLead(t.deps, lead({ source: "contact_form", kind: "partner", email: "s@x.qa", message: "Hi", locale: "ar" }));
    expect(r).toEqual({ saved: true, emailed: true });
    expect(t.inserts).toEqual([
      { client: "user", table: "inquiries", row: { name: "Sara", phone: "+97455123456", email: "s@x.qa", message: "Partnership: Hi", locale: "ar", status: "new" } },
    ]);
    expect(t.emails).toHaveLength(1);
    expect(t.emails[0]).toMatchObject({
      to: ["owner@example.test"],
      replyTo: "s@x.qa",
      subject: "New contact message — Sara (partnership)",
    });
    expect(t.emails[0].html).toContain("Sara");
  });

  it("replyTo falls back to the owner when the visitor gave no email", async () => {
    const t = setup();
    await createLead(t.deps, lead({ source: "store_callback" }));
    expect(t.emails[0].replyTo).toBe("owner@example.test");
    expect(t.emails[0].subject).toBe("New store callback request — Sara");
  });

  it("does not insert when Supabase is not configured but still emails", async () => {
    const t = setup({ canSave: false });
    expect(await createLead(t.deps, lead({ source: "store_callback" }))).toEqual({ saved: false, emailed: true });
    expect(t.inserts).toEqual([]);
  });

  it("insert error -> saved false; email still lands; neither -> not delivered", async () => {
    const t = setup({ user: { insertError: { message: "boom" } } });
    const r = await createLead(t.deps, lead({ source: "store_callback" }));
    expect(r).toEqual({ saved: false, emailed: true });
    expect(leadDelivered(r)).toBe(true);

    const n = setup({ user: { insertError: { message: "boom" } }, sendEmail: async () => false });
    const none = await createLead(n.deps, lead({ source: "store_callback" }));
    expect(none).toEqual({ saved: false, emailed: false });
    expect(leadDelivered(none)).toBe(false);
  });

  it("a throwing email sender or client is swallowed as false", async () => {
    const t = setup({
      sendEmail: async () => {
        throw new Error("smtp");
      },
      userClient: async () => {
        throw new Error("no cookies");
      },
    });
    expect(await createLead(t.deps, lead({ source: "store_callback" }))).toEqual({ saved: false, emailed: false });
  });
});

describe("createLead - bom_quote", () => {
  it("builds the message from the items, the project name (RLS read) and the note", async () => {
    const t = setup();
    await createLead(
      t.deps,
      lead({ source: "bom_quote", projectId: PROJECT, note: "urgent", items: [{ function: "LED", spec: "red", quantity: 3 }, { function: "Servo" }] }),
    );
    const msg = t.inserts[0].row.message as string;
    expect(msg).toBe(
      [
        "Quote request for 2 unstocked items.",
        `Project: Rover — ${ORIGIN}/en/projects/${PROJECT}`,
        "- LED — red × 3\n- Servo × 1",
        "Note:\nurgent",
      ].join("\n\n"),
    );
    expect(t.emails[0].subject).toBe("Quote request — Sara · 2 unstocked items");
  });

  it("an unreadable project keeps the link only", async () => {
    const t = setup({ user: { projectName: null } });
    await createLead(t.deps, lead({ source: "bom_quote", projectId: PROJECT, items: [{ function: "LED" }] }));
    expect(t.inserts[0].row.message).toContain("Project: (name not readable)");
    expect(t.emails[0].subject).toBe("Quote request — Sara · 1 unstocked item");
  });
});

describe("createLead - studio_quote", () => {
  const body = { source: "studio_quote", projectId: PROJECT, designName: "Arm", items: [{ function: "Base" }, { function: "Link" }] };

  it("computes the calculation server-side and writes it with the service client", async () => {
    const t = setup();
    const r = await createLead(t.deps, lead(body));
    expect(r.saved).toBe(true);
    expect(t.calcCalls).toEqual([[PROJECT, `${ORIGIN}/en/projects/${PROJECT}/studio`]]);
    expect(t.inserts).toHaveLength(1);
    expect(t.inserts[0]).toMatchObject({ client: "service", row: { project_id: PROJECT, quote_calc: t.calc, status: "new" } });
    expect(t.inserts[0].row.message).toBe(
      [`Design Studio: Arm — ${ORIGIN}/en/projects/${PROJECT}/studio`, `Project: Rover — ${ORIGIN}/en/projects/${PROJECT}/studio`, "- Base\n- Link"].join("\n\n"),
    );
    expect(t.emails[0].subject).toBe("Design Studio — get it made — Sara");
  });

  it("falls back to the plain RLS insert when 0073 is missing, losing only the calculation", async () => {
    const t = setup({ svc: { insertError: { message: 'column "quote_calc" does not exist' } } });
    const r = await createLead(t.deps, lead(body));
    expect(r.saved).toBe(true);
    expect(t.inserts.map((i) => i.client)).toEqual(["service", "user"]);
    expect(t.inserts[1].row).not.toHaveProperty("quote_calc");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("logs a service insert failure that is not the missing-column case", async () => {
    const t = setup({ svc: { insertError: { message: "rls" } } });
    await createLead(t.deps, lead(body));
    expect(console.error).toHaveBeenCalled();
    expect(t.inserts.map((i) => i.client)).toEqual(["service", "user"]);
  });

  it("without the service key the plain lead is saved", async () => {
    const t = setup({ svc: null });
    await createLead(t.deps, lead(body));
    expect(t.inserts.map((i) => i.client)).toEqual(["user"]);
  });

  it("an unreadable project gets no calculation (so no service write)", async () => {
    const t = setup({ user: { projectName: null } });
    await createLead(t.deps, lead(body));
    expect(t.calcCalls).toEqual([]);
    expect(t.inserts.map((i) => i.client)).toEqual(["user"]);
  });

  it("lists only the caller's own STL files", async () => {
    const own = `cad-files/${USER}/${PROJECT}/print/1/a.stl`;
    const foreign = `cad-files/33333333-3333-4333-8333-333333333333/${PROJECT}/print/1/b.stl`;
    const t = setup();
    await createLead(t.deps, lead({ ...body, files: [own, foreign] }));
    const msg = t.inserts[0].row.message as string;
    expect(msg).toContain(`Files:\n- ${own}`);
    expect(msg).not.toContain(foreign);
  });
});

describe("createLead - print_request", () => {
  it("summarises parts, grams, materials and files, and mentions the attachments in the e-mail", async () => {
    const own = `cad-files/${USER}/${PROJECT}/print/1/a.stl`;
    const t = setup();
    await createLead(
      t.deps,
      lead({
        source: "print_request",
        projectId: PROJECT,
        designName: "Arm",
        files: [own],
        items: [
          { function: "Base", spec: "PLA · 12 g" },
          { function: "Link", spec: "PETG · 8.4 g" },
        ],
      }),
    );
    const link = `${ORIGIN}/en/projects/${PROJECT}/studio?step=print`;
    const msg = t.inserts[0].row.message as string;
    expect(msg.split("\n\n")).toEqual([
      `Print request: Arm — ${link} — 2 parts, ≈ 20 g, materials PLA, PETG`,
      `Project: Rover — ${link}`,
      "- Base — PLA · 12 g\n- Link — PETG · 8.4 g",
      `Files:\n- ${own}`,
    ]);
    expect(t.inserts[0].client).toBe("user");
    expect(t.emails[0].subject).toBe("Print request — Sara · 2 parts");
    expect(t.emails[0].text).toContain("1 STL file attached");
  });

  it("says so when no files were uploaded, and prefers the posted gram total", async () => {
    const t = setup();
    await createLead(t.deps, lead({ source: "print_request", totalGrams: 99.6, items: [{ function: "Base", spec: "PLA · 12 g" }] }));
    const msg = t.inserts[0].row.message as string;
    expect(msg).toContain("1 part, ≈ 100 g, materials PLA");
    expect(msg).toContain("Files: none uploaded");
    expect(t.emails[0].text).not.toContain("STL file");
  });
});
