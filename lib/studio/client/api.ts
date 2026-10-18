"use client";

// The Design Studio's one door to the outside world. StudioShell and its
// steps only talk to a StudioApi, so the e2e fixture can inject a mock
// (lib/studio/client/mock.ts) and the real page uses liveStudioApi(): the
// /api/studio/* routes plus a few RLS-scoped browser reads/writes (project
// name, AI consent, store products, phone) exactly like the rest of the site.

import { loadSupabase } from "@/lib/supabase/lazy";
import { CAD_BUCKET } from "@/lib/design/constants";
import { DEFAULT_PROJECT_NAME } from "@/lib/projects/create-from-chat";
import { EMPTY_SPEC, hasAiConsent, type Spec } from "@/lib/prototyping/spec";
import { STORE_CARD_COLUMNS, type StoreCardPart } from "@/lib/store/catalog";
import type { EnclosureSpec, MechPart, Net, ProductSpec, StudioCheck, StudioComponent, StudioDoc } from "@/lib/studio/schema";
import type { ProductMockOptions } from "@/lib/studio/geometry/protocol";
import { PROJECT_IMAGE_BUCKET } from "@/lib/projects/constants";
import type { TokenInfo } from "@/lib/studio/server/tokens";
import type { IdeaMessage } from "./steps";

export type { TokenInfo };

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

/**
 * One idea-chat turn: a question, the first card (maybe with a reply, e.g. scope
 * honesty), or — once the card exists (Part A) — a reply with a spec only when the
 * card changed and `changed` = short labels of what changed.
 */
export type SpecReply = (
  | { question: string; choices: string[] }
  | { spec: ProductSpec; reply?: string }
  | { reply: string; spec?: ProductSpec; changed: string[] }
) & { tokens?: TokenInfo };
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
export type MechReply = { mech: MechPart[]; docVersion: number | null };
/** The sketch for the chosen board: board + code are saved in doc.firmware; steps / libraries are shown once. */
export type StudioFirmware = {
  board: string;
  code: string;
  fileName?: string;
  steps?: string[];
  libraries?: { name: string; why: string }[];
};
export type FirmwareReply = { firmware: StudioFirmware; docVersion: number | null };
export type PrintFile = { name: string; data: ArrayBuffer | string };
export type PrintRequest = {
  name: string;
  phone: string;
  locale: Locale;
  designName: string;
  /** One line per printable part (quantity is always 1). */
  parts: { name: string; material: string; grams: number }[];
  totalGrams: number;
  /** Storage paths ("cad-files/<user>/<project>/print/…") of the uploaded STLs. */
  files: string[];
};
export type Profile = {
  userId: string | null;
  phone: string | null;
  fullName: string | null;
  /** The account email (W2: prefilled in "Get it made"); null for guests. */
  email?: string | null;
  /** An anonymous (guest) session: "Get it made" asks to sign in / up first (W2). */
  guest?: boolean;
};
export type QuoteRequest = {
  name: string;
  phone: string;
  items: string[];
  locale: Locale;
  designName: string;
  /** W2 "Get it made" pop-up. */
  email?: string;
  note?: string;
  /** P5-16: the unlocked product's STLs, uploaded first (cad-files/<user>/<project>/print/…). */
  files?: string[];
};

export interface StudioApi {
  /** "live" talks to Supabase and the routes; "mock" is the e2e fixture. */
  readonly mode: "live" | "mock";
  readonly projectId: string;
  load(): Promise<LoadResult>;
  save(doc: StudioDoc, version: number): Promise<SaveResult>;
  /** Ideation token balance + tier (migration 0088); null before it runs or in the mock. */
  tokens?(): Promise<TokenInfo | null>;
  /** `current` = the card already shown: the last user message refines it (W3). */
  spec(body: { idea: string; messages: IdeaMessage[]; locale: Locale; current?: ProductSpec | null }): Promise<Res<SpecReply>>;
  pick(spec: ProductSpec, locale: Locale): Promise<Res<PickReply>>;
  wiring(spec: ProductSpec, components: StudioComponent[], locale: Locale): Promise<Res<WiringReply>>;
  enclosure(
    spec: ProductSpec,
    components: StudioComponent[],
    bbox: { w: number; d: number; h: number },
    locale: Locale,
  ): Promise<Res<EnclosureReply>>;
  /** Printable parts for the saved enclosure (free). `doc` is what the browser has (the mock uses it). */
  mech(doc: StudioDoc, dims: { w: number; d: number; h: number } | null): Promise<Res<MechReply>>;
  /** Starter code for the chosen board from the wiring (free, like /api/firmware). */
  firmware(spec: ProductSpec, components: StudioComponent[], locale: Locale): Promise<Res<FirmwareReply>>;
  /** Uploads the STLs to the visitor's own folder in the private cad-files bucket; returns the stored paths. */
  uploadPrintFiles(files: PrintFile[]): Promise<string[]>;
  requestPrint(q: PrintRequest): Promise<boolean>;
  giveConsent(destination: string): Promise<boolean>;
  /** Names a "New project" after the idea (never renames a project the user named). */
  rename(name: string): Promise<void>;
  storeProducts(skus: string[]): Promise<Map<string, StoreCardPart>>;
  profile(): Promise<Profile>;
  /** D4: an anonymous (guest) session, for the "Saved on this device" wording. Absent = not a guest. */
  isGuest?(): Promise<boolean>;
  /** W2: keep a typed name / WhatsApp number on the profile so it is never asked again (best-effort). */
  saveContact(c: { fullName?: string; phone?: string }): Promise<void>;
  requestQuote(q: QuoteRequest): Promise<boolean>;
  /**
   * P5-16 product designs (Phase 2b). Absent = the Studio keeps the template enclosure
   * flow. The worker calls design / check / preview / model itself (`base`); the page
   * only calls choose / unlock / engineer.
   */
  product?: ProductApi;
}

/** What the Engineer view (super_admin) shows per design (GET /engineer = productPrivate). */
export type EngineerDesign = {
  id: string;
  model?: unknown;
  solvedHash?: string;
  score?: number;
  loops?: number;
  looksLike?: string;
  missing?: string[];
  issues?: unknown[];
  source?: string;
};

export interface ProductApi {
  /** Endpoint base the worker uses ("/api/studio/product"). */
  readonly base: string;
  /** e2e fixture only: the worker answers the endpoints itself. */
  readonly mock: ProductMockOptions | null;
  choose(designId: string): Promise<Res<{ chosenId: string }>>;
  /** "Create my CAD": 1 CAD credit (same mechanism as the enclosure). 402 no_credits / 401|403 sign_in. */
  unlock(designId: string): Promise<Res<{ unlockedId: string }>>;
  /** super_admin only. `doc` is what the browser has (the mock uses it). */
  engineer(doc: StudioDoc): Promise<Res<{ designs: EngineerDesign[] }>>;
  /** A URL for a stored preview picture (signed when the bucket is private); null = unknown. */
  previewUrl(path: string): Promise<string | null>;
}

/** previewPath → bucket + key: "studio-previews/…" lives in the project-images bucket; "bucket/…" names its bucket. */
export function previewObject(path: string): { bucket: string; key: string } | null {
  const clean = path.replace(/^\/+/, "");
  if (!clean || clean.includes("..")) return null;
  if (clean.startsWith("studio-previews/")) return { bucket: PROJECT_IMAGE_BUCKET, key: clean };
  const [bucket, ...rest] = clean.split("/");
  return rest.length ? { bucket, key: rest.join("/") } : null;
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
  // supabase-js loads on first use (its own chunk, shared with the site header).
  const db = () => loadSupabase();
  return {
    mode: "live",
    projectId,

    async load() {
      const { data: project, error } = await (await db())
        .from("projects")
        .select("id, name, brief, spec")
        .eq("id", projectId)
        .maybeSingle();
      if (error) return { ok: false, error: "failed" };
      if (!project) {
        const { data: auth } = await (await db()).auth.getUser();
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

    spec: ({ idea, messages, locale, current }) => postJson("/api/studio/spec", { projectId, locale, idea, messages, current: current ?? null }),
    async tokens() {
      try {
        const res = await fetch(`/api/studio/tokens?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { tokens?: TokenInfo | null };
        return res.ok ? (body.tokens ?? null) : null;
      } catch {
        return null;
      }
    },
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

    mech: (_doc, dims) => postJson("/api/studio/mech", { projectId, ...(dims ? { dims } : {}) }),
    firmware: (spec, components, locale) => postJson("/api/studio/firmware", { projectId, locale, spec, components }),

    async uploadPrintFiles(files) {
      const { data: auth } = await (await db()).auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return [];
      // 0018 / 0045: the visitor may write under <user_id>/…; <project_id> second keeps the
      // owner-by-project read policy working too. A failed file is left out, never fatal.
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const out: string[] = [];
      for (const f of files) {
        const safe = f.name.replace(/[^\w.-]+/g, "_").slice(0, 80) || "part.stl";
        const path = `${uid}/${projectId}/print/${stamp}/${safe}`;
        const body = new Blob([f.data], { type: "model/stl" });
        const { error } = await (await db()).storage.from(CAD_BUCKET).upload(path, body, { contentType: "model/stl", upsert: false });
        if (!error) out.push(`${CAD_BUCKET}/${path}`);
      }
      return out;
    },

    async requestPrint(q) {
      const r = await postJson<{ ok?: boolean }>("/api/store-lead", {
        source: "print_request",
        name: q.name,
        phone: q.phone,
        locale: q.locale,
        projectId,
        designName: q.designName,
        items: q.parts.map((p) => ({ function: p.name, spec: `${p.material} · ${p.grams} g`, quantity: 1 })),
        totalGrams: q.totalGrams,
        files: q.files,
      });
      return r.ok;
    },

    async giveConsent(destination) {
      const { data } = await (await db()).from("projects").select("spec").eq("id", projectId).maybeSingle();
      const spec = ((data as { spec: Spec | null } | null)?.spec ?? EMPTY_SPEC) as Spec;
      const { error } = await (await db())
        .from("projects")
        .update({ spec: { ...spec, aiConsent: { at: new Date().toISOString(), destination } } })
        .eq("id", projectId);
      return !error;
    },

    async rename(name) {
      const clean = name.trim().slice(0, 80);
      if (!clean) return;
      await (await db()).from("projects").update({ name: clean }).eq("id", projectId).eq("name", DEFAULT_PROJECT_NAME);
    },

    async storeProducts(skus) {
      const out = new Map<string, StoreCardPart>();
      const wanted = [...new Set(skus.filter(Boolean))];
      if (!wanted.length) return out;
      const { data } = await (await db())
        .from("parts")
        .select(`${STORE_CARD_COLUMNS}, images`)
        .in("sku", wanted)
        .eq("is_published", true)
        .is("merged_into", null);
      for (const p of (data ?? []) as unknown as StoreCardPart[]) out.set(p.sku, p);
      return out;
    },

    async isGuest() {
      const { data: auth } = await (await db()).auth.getUser();
      return auth.user?.is_anonymous === true;
    },

    async profile() {
      const { data: auth } = await (await db()).auth.getUser();
      const user = auth.user;
      if (!user) return { userId: null, phone: null, fullName: null, email: null, guest: true };
      const { data } = await (await db()).from("profiles").select("phone, full_name").eq("id", user.id).maybeSingle();
      const row = (data ?? {}) as { phone?: string | null; full_name?: string | null };
      const meta = (user.user_metadata ?? {}) as { full_name?: unknown };
      const metaName = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
      return {
        userId: user.id,
        phone: row.phone?.trim() || null,
        fullName: row.full_name?.trim() || metaName || null,
        email: user.email?.trim() || null,
        guest: user.is_anonymous === true,
      };
    },

    async saveContact(c) {
      const patch: Record<string, string> = {};
      if (c.fullName?.trim()) patch.full_name = c.fullName.trim().slice(0, 120);
      if (c.phone?.trim()) patch.phone = c.phone.trim();
      if (!Object.keys(patch).length) return;
      try {
        const { data: auth } = await (await db()).auth.getUser();
        if (!auth.user) return;
        await (await db()).from("profiles").update(patch).eq("id", auth.user.id);
      } catch {
        /* best-effort: the request went out either way */
      }
    },

    async requestQuote(q) {
      const r = await postJson<{ ok?: boolean }>("/api/store-lead", {
        source: "studio_quote",
        name: q.name,
        phone: q.phone,
        ...(q.email ? { email: q.email } : {}),
        ...(q.note ? { note: q.note } : {}),
        locale: q.locale,
        projectId,
        designName: q.designName,
        items: q.items.map((name) => ({ function: name, quantity: 1 })),
        ...(q.files?.length ? { files: q.files } : {}),
      });
      return r.ok;
    },

    product: {
      base: PRODUCT_BASE,
      mock: null,
      choose: (designId) => postJson(`${PRODUCT_BASE}/choose`, { projectId, designId }),
      unlock: (designId) => postJson(`${PRODUCT_BASE}/unlock`, { projectId, designId }),
      async engineer() {
        try {
          const res = await fetch(`${PRODUCT_BASE}/engineer?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
          const data = (await res.json().catch(() => ({}))) as { designs?: EngineerDesign[]; error?: string };
          if (!res.ok || data.error) return { ok: false, status: res.status, error: data.error ?? "failed" };
          return { ok: true, data: { designs: Array.isArray(data.designs) ? data.designs : [] } };
        } catch {
          return { ok: false, status: 0, error: "failed" };
        }
      },
      async previewUrl(path) {
        if (/^(https?:|blob:|data:|\/)/.test(path)) return path;
        const obj = previewObject(path);
        if (!obj) return null;
        try {
          const { data } = await (await db()).storage.from(obj.bucket).createSignedUrl(obj.key, 3600);
          return data?.signedUrl ?? null;
        } catch {
          return null;
        }
      },
    },
  };
}

const PRODUCT_BASE = "/api/studio/product";
