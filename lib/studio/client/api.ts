"use client";

// The Design Studio's one door to the outside world. StudioShell and its
// steps only talk to a StudioApi, so the e2e fixture can inject a mock
// (lib/studio/client/mock.ts) and the real page uses liveStudioApi(): the
// /api/studio/* routes plus a few RLS-scoped browser reads/writes (project
// name, AI consent, store products, phone) exactly like the rest of the site.

import { createClient } from "@/lib/supabase/client";
import { DEFAULT_PROJECT_NAME } from "@/lib/projects/create-from-chat";
import { EMPTY_SPEC, hasAiConsent, type Spec } from "@/lib/prototyping/spec";
import { STORE_CARD_COLUMNS, type StoreCardPart } from "@/lib/store/catalog";
import type { EnclosureSpec, Net, ProductSpec, StudioCheck, StudioComponent, StudioDoc } from "@/lib/studio/schema";
import type { IdeaMessage } from "./steps";

export type Locale = "en" | "ar";

export type Res<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export type StudioProject = { name: string; consented: boolean; brief: string | null };

export type LoadResult =
  | { ok: true; project: StudioProject; doc: StudioDoc | null; version: number; persist: boolean }
  | { ok: false; error: "sign_in" | "not_found" | "failed" };

export type SaveResult =
  | { ok: true; version: number }
  | { ok: false; error: "conflict"; doc: StudioDoc | null; version: number }
  | { ok: false; error: "run_0068" | "failed" };

export type SpecReply = { question: string; choices: string[] } | { spec: ProductSpec };
export type PickReply = { components: StudioComponent[]; docVersion: number | null };
export type WiringReply = {
  components: StudioComponent[];
  netlist: { nets: Net[] };
  checks: StudioCheck[];
  docVersion: number | null;
};
export type EnclosureReply = {
  enclosure: EnclosureSpec;
  versionsLeft: number | null;
  fallback: boolean;
  docVersion: number | null;
};
export type Profile = { userId: string | null; phone: string | null; fullName: string | null };
export type QuoteRequest = { name: string; phone: string; items: string[]; locale: Locale; designName: string };

export interface StudioApi {
  /** "live" talks to Supabase and the routes; "mock" is the e2e fixture. */
  readonly mode: "live" | "mock";
  readonly projectId: string;
  load(): Promise<LoadResult>;
  save(doc: StudioDoc, version: number): Promise<SaveResult>;
  spec(body: { idea: string; messages: IdeaMessage[]; locale: Locale }): Promise<Res<SpecReply>>;
  pick(spec: ProductSpec, locale: Locale): Promise<Res<PickReply>>;
  wiring(spec: ProductSpec, components: StudioComponent[], locale: Locale): Promise<Res<WiringReply>>;
  enclosure(
    spec: ProductSpec,
    components: StudioComponent[],
    bbox: { w: number; d: number; h: number },
    locale: Locale,
  ): Promise<Res<EnclosureReply>>;
  giveConsent(destination: string): Promise<boolean>;
  /** Names a "New project" after the idea (never renames a project the user named). */
  rename(name: string): Promise<void>;
  storeProducts(skus: string[]): Promise<Map<string, StoreCardPart>>;
  profile(): Promise<Profile>;
  requestQuote(q: QuoteRequest): Promise<boolean>;
}

async function postJson<T>(url: string, body: unknown): Promise<Res<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok || (data as { error?: string }).error) {
      return { ok: false, status: res.status, error: (data as { error?: string }).error ?? "failed" };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, status: 0, error: "failed" };
  }
}

export function liveStudioApi(projectId: string): StudioApi {
  const db = () => createClient();
  return {
    mode: "live",
    projectId,

    async load() {
      const { data: project, error } = await db()
        .from("projects")
        .select("id, name, brief, spec")
        .eq("id", projectId)
        .maybeSingle();
      if (error) return { ok: false, error: "failed" };
      if (!project) {
        const { data: auth } = await db().auth.getUser();
        return { ok: false, error: auth.user ? "not_found" : "sign_in" };
      }
      const row = project as { name: string | null; brief: string | null; spec: Spec | null };
      const info: StudioProject = {
        name: row.name ?? "",
        consented: hasAiConsent(row.spec),
        brief: typeof row.brief === "string" && row.brief.trim() ? row.brief : null,
      };
      try {
        const res = await fetch(`/api/studio/doc?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { doc?: StudioDoc | null; version?: number; error?: string };
        if (!res.ok) return { ok: false, error: res.status === 401 ? "sign_in" : res.status === 404 ? "not_found" : "failed" };
        // Before 0068 the doc lives in memory only (persist false).
        return { ok: true, project: info, doc: body.doc ?? null, version: body.version ?? 0, persist: body.error !== "run_0068" };
      } catch {
        return { ok: false, error: "failed" };
      }
    },

    async save(doc, version) {
      try {
        const res = await fetch("/api/studio/doc", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId, doc, version }),
        });
        const body = (await res.json().catch(() => ({}))) as { version?: number; doc?: StudioDoc | null; error?: string };
        if (res.ok && typeof body.version === "number") return { ok: true, version: body.version };
        if (body.error === "conflict") return { ok: false, error: "conflict", doc: body.doc ?? null, version: body.version ?? version };
        if (body.error === "run_0068") return { ok: false, error: "run_0068" };
        return { ok: false, error: "failed" };
      } catch {
        return { ok: false, error: "failed" };
      }
    },

    spec: ({ idea, messages, locale }) => postJson("/api/studio/spec", { projectId, locale, idea, messages }),
    pick: (spec, locale) => postJson("/api/studio/pick", { projectId, locale, spec }),
    wiring: (spec, components, locale) => postJson("/api/studio/wiring", { projectId, locale, spec, components }),
    enclosure: (spec, components, bbox, locale) =>
      postJson("/api/studio/enclosure", {
        projectId,
        locale,
        spec,
        components: components.map((c) => ({ partId: c.partId, label: c.label.slice(0, 60) })),
        bbox,
      }),

    async giveConsent(destination) {
      const { data } = await db().from("projects").select("spec").eq("id", projectId).maybeSingle();
      const spec = ((data as { spec: Spec | null } | null)?.spec ?? EMPTY_SPEC) as Spec;
      const { error } = await db()
        .from("projects")
        .update({ spec: { ...spec, aiConsent: { at: new Date().toISOString(), destination } } })
        .eq("id", projectId);
      return !error;
    },

    async rename(name) {
      const clean = name.trim().slice(0, 80);
      if (!clean) return;
      await db().from("projects").update({ name: clean }).eq("id", projectId).eq("name", DEFAULT_PROJECT_NAME);
    },

    async storeProducts(skus) {
      const out = new Map<string, StoreCardPart>();
      const wanted = [...new Set(skus.filter(Boolean))];
      if (!wanted.length) return out;
      const { data } = await db()
        .from("parts")
        .select(STORE_CARD_COLUMNS)
        .in("sku", wanted)
        .eq("is_published", true)
        .is("merged_into", null);
      for (const p of (data ?? []) as unknown as StoreCardPart[]) out.set(p.sku, p);
      return out;
    },

    async profile() {
      const { data: auth } = await db().auth.getUser();
      const user = auth.user;
      if (!user) return { userId: null, phone: null, fullName: null };
      const { data } = await db().from("profiles").select("phone, full_name").eq("id", user.id).maybeSingle();
      const row = (data ?? {}) as { phone?: string | null; full_name?: string | null };
      return { userId: user.id, phone: row.phone?.trim() || null, fullName: row.full_name?.trim() || null };
    },

    async requestQuote(q) {
      const r = await postJson<{ ok?: boolean }>("/api/store-lead", {
        source: "studio_quote",
        name: q.name,
        phone: q.phone,
        locale: q.locale,
        projectId,
        designName: q.designName,
        items: q.items.map((name) => ({ function: name, quantity: 1 })),
      });
      return r.ok;
    },
  };
}
