"use client";

// Design Studio (P5-13 Phase 1): one flow, one step card at a time.
//
//  * The StudioDoc (projects.studio, migration 0068) is loaded through the
//    StudioApi (GET /api/studio/doc). Before 0068 runs the route answers
//    run_0068 and the doc simply lives in memory (persist = false).
//  * Local edits are saved with PUT + the version (debounced). A conflict
//    means another tab saved first: we take its doc. The routes that write
//    themselves (pick / wiring / enclosure) return docVersion, which we adopt;
//    pending edits are flushed BEFORE those calls so nothing is lost.
//  * "Done" per step is derived from the doc (lib/studio/client/steps.ts);
//    done steps are tappable in the progress line, future ones are not.
//  * ?step= deep-links to any reachable step; the URL follows the current step.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { chatStorageKey, parseHandoff } from "@/lib/projects/create-from-chat";
import { getPart } from "@/lib/studio/library";
import { emptyStudioDoc, type EnclosureSpec, type ProductSpec, type StudioComponent, type StudioDoc } from "@/lib/studio/schema";
import type { StoreCardPart } from "@/lib/store/catalog";
import { liveStudioApi, type Locale, type StudioApi, type StudioProject } from "@/lib/studio/client/api";
import { FLOW, furthestStep, initialStep, sameSpec, stepDone, type FlowStep } from "@/lib/studio/client/steps";
import { ProgressLine } from "./ProgressLine";
import { Bar, MainButton } from "./ui";
import { IdeaStep } from "./steps/IdeaStep";
import { PartsStep } from "./steps/PartsStep";
import { WiringStep } from "./steps/WiringStep";
import { EnclosureStep } from "./steps/EnclosureStep";
import { CodeStep } from "./steps/CodeStep";
import { MakeStep } from "./steps/MakeStep";

export type StudioCtx = {
  api: StudioApi;
  locale: Locale;
  projectId: string;
  projectName: string;
  /** Step number (1-based) and accent come from the step id. */
  n: (step: FlowStep) => number;
};

type Loaded =
  | { state: "loading" }
  | { state: "error"; error: "sign_in" | "not_found" | "failed" }
  | { state: "ready"; project: StudioProject };

const SAVE_DELAY_MS = 700;

export function StudioShell({
  projectId,
  destination,
  startChat = false,
  requestedStep = null,
  api: injected,
}: {
  projectId: string;
  /** Where the idea goes (providerStatus().destination), for the consent line. */
  destination: string;
  /** Opened from /projects/new: carry on with the first message. */
  startChat?: boolean;
  requestedStep?: string | null;
  /** Test fixture only: a mock StudioApi. */
  api?: StudioApi;
}) {
  const t = useTranslations("Studio");
  const locale: Locale = useLocale() === "ar" ? "ar" : "en";
  const api = useMemo(() => injected ?? liveStudioApi(projectId), [injected, projectId]);

  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [doc, setDoc] = useState<StudioDoc | null>(null);
  const [current, setCurrent] = useState(0);
  const [visited, setVisited] = useState(0);
  const [handoffIdea, setHandoffIdea] = useState<string | null>(null);
  const [consented, setConsented] = useState(false);

  // Save machinery (refs: always the latest values inside async code).
  const latest = useRef<StudioDoc | null>(null);
  const version = useRef(0);
  const persist = useRef(true);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback((): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    chain.current = chain.current.then(async () => {
      if (!dirty.current || !persist.current || !latest.current) return;
      dirty.current = false;
      const r = await api.save(latest.current, version.current);
      if (r.ok) version.current = r.version;
      else if (r.error === "conflict") {
        // Someone saved first (another tab): theirs wins, ours is dropped.
        version.current = r.version;
        if (r.doc) {
          latest.current = r.doc;
          setDoc(r.doc);
        }
      } else if (r.error === "run_0068") persist.current = false;
      else dirty.current = true; // network blip: try again with the next change
    });
    return chain.current;
  }, [api]);

  /** Apply a new doc. `serverVersion` = the route already saved it (no PUT). */
  const commit = useCallback(
    (next: StudioDoc, serverVersion?: number | null) => {
      latest.current = next;
      setDoc(next);
      if (typeof serverVersion === "number") {
        version.current = serverVersion;
        return;
      }
      dirty.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  // Load once.
  useEffect(() => {
    let alive = true;
    void api.load().then((r) => {
      if (!alive) return;
      if (!r.ok) {
        setLoaded({ state: "error", error: r.error });
        return;
      }
      latest.current = r.doc;
      version.current = r.version;
      persist.current = r.persist;
      setDoc(r.doc);
      setConsented(r.project.consented);
      if (startChat && !r.doc) {
        try {
          const key = chatStorageKey(projectId);
          const h = parseHandoff(sessionStorage.getItem(key));
          sessionStorage.removeItem(key);
          const first = h?.messages.find((m) => m.role === "user")?.text ?? null;
          if (first) setHandoffIdea(first);
        } catch {
          /* storage blocked: the chat starts empty */
        }
      }
      const start = initialStep(r.doc, requestedStep);
      setCurrent(start);
      setVisited(start);
      setLoaded({ state: "ready", project: r.project });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per project
  }, [api]);

  // Save what is pending when the page goes away.
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
    };
  }, [flush]);

  const furthest = furthestStep(doc, visited);
  const go = useCallback(
    (i: number) => {
      const idx = Math.max(0, Math.min(FLOW.length - 1, i));
      void flush();
      setCurrent(idx);
      setVisited((v) => Math.max(v, idx));
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("step", FLOW[idx]);
        url.searchParams.delete("start");
        window.history.replaceState(window.history.state, "", url.toString());
      } catch {
        /* no URL update: fine */
      }
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [flush],
  );
  const next = useCallback(() => go(current + 1), [go, current]);

  // ── Store products for the parts (shared by Parts and Make) ──────────────
  const skus = useMemo(
    () => (doc?.components ?? []).flatMap((c) => getPart(c.partId)?.storeSkus ?? []).sort().join(","),
    [doc?.components],
  );
  const [products, setProducts] = useState<Map<string, StoreCardPart>>(new Map());
  const [productsLoading, setProductsLoading] = useState(false);
  useEffect(() => {
    if (!skus) {
      setProducts(new Map());
      return;
    }
    let alive = true;
    setProductsLoading(true);
    void api
      .storeProducts(skus.split(","))
      .then((m) => alive && setProducts(m))
      .catch(() => {})
      .finally(() => alive && setProductsLoading(false));
    return () => {
      alive = false;
    };
  }, [api, skus]);

  // ── Step results ─────────────────────────────────────────────────────────
  const onIdeaConfirmed = useCallback(
    (spec: ProductSpec, answers: Record<string, string>) => {
      const prev = latest.current;
      const base = prev ?? emptyStudioDoc(spec);
      const same = prev ? sameSpec(prev.spec, spec) : false;
      const nextDoc: StudioDoc = same
        ? { ...base, answers }
        : {
            ...base,
            spec,
            answers,
            // A different idea: the parts and everything after are redone.
            components: [],
            netlist: { nets: [] },
            checks: [],
            enclosure: null,
            enclosureVersions: [],
            layout: [],
            mech: [],
          };
      commit(nextDoc);
      void api.rename(spec.name);
      go(FLOW.indexOf("parts"));
    },
    [api, commit, go],
  );

  const onComponents = useCallback(
    (components: StudioComponent[], serverVersion: number | null, edited: boolean) => {
      const base = latest.current;
      if (!base) return;
      commit(
        edited
          ? // A changed list: the old circuit and layout no longer apply.
            { ...base, components, netlist: { nets: [] }, checks: [], layout: [], mech: [] }
          : { ...base, components },
        edited ? undefined : serverVersion,
      );
    },
    [commit],
  );

  const onWiring = useCallback(
    (w: { components: StudioComponent[]; netlist: StudioDoc["netlist"]; checks: StudioDoc["checks"] }, serverVersion: number | null) => {
      const base = latest.current;
      if (!base) return;
      commit({ ...base, components: w.components, netlist: w.netlist, checks: w.checks }, serverVersion);
    },
    [commit],
  );

  const onEnclosure = useCallback(
    (enclosure: EnclosureSpec, opts: { serverVersion?: number | null; fresh?: boolean; layout?: StudioDoc["layout"] }) => {
      const base = latest.current;
      if (!base) return;
      const versions = opts.fresh ? [...(base.enclosureVersions ?? []), enclosure].slice(-3) : base.enclosureVersions;
      const nextDoc: StudioDoc = { ...base, enclosure, enclosureVersions: versions, layout: opts.layout ?? base.layout };
      if (opts.fresh && typeof opts.serverVersion === "number") {
        // The route saved the enclosure; the layout is ours to add.
        version.current = opts.serverVersion;
      }
      commit(nextDoc);
    },
    [commit],
  );

  const flushBeforeServer = useCallback(() => flush(), [flush]);

  // ── Render ───────────────────────────────────────────────────────────────
  if (loaded.state === "loading") {
    return (
      <div className="space-y-5" role="status" aria-busy="true">
        <span className="sr-only">{t("loading")}</span>
        <div className="neu flex justify-between gap-3 px-5 py-4">
          {FLOW.map((s) => (
            <Bar key={s} className="h-7 w-7 rounded-full" />
          ))}
        </div>
        <div className="neu space-y-4 p-5 sm:p-8">
          <Bar className="h-3 w-32" />
          <Bar className="h-7 w-2/3" />
          <Bar className="h-4 w-full" />
          <Bar className="h-24 w-full rounded-2xl" />
        </div>
      </div>
    );
  }
  if (loaded.state === "error") {
    return (
      <div className="neu space-y-4 p-6 text-center sm:p-10" role="alert">
        <p className="text-base font-semibold text-heading">
          {loaded.error === "sign_in" ? t("signInNeeded") : t("loadFailed")}
        </p>
        {loaded.error === "sign_in" ? (
          <Link href="/sign-in" className="inline-flex min-h-11 items-center font-semibold text-cobalt hover:text-cobalt-hover">
            {t("signIn")}
          </Link>
        ) : (
          <MainButton onClick={() => window.location.reload()}>{t("tryAgain")}</MainButton>
        )}
      </div>
    );
  }

  const projectName = doc?.spec.name ?? loaded.project.name;
  const step = FLOW[current];
  const n = (s: FlowStep) => FLOW.indexOf(s) + 1;
  const ctx: StudioCtx = { api, locale, projectId, projectName, n };

  return (
    <div className="space-y-5" data-testid="studio-shell" data-step={step}>
      <ProgressLine current={current} furthest={furthest} done={(s) => stepDone(s, doc)} onGo={go} />
      <div key={step} className="motion-safe:animate-rise">
        {step === "idea" && (
          <IdeaStep
            ctx={ctx}
            doc={doc}
            consented={consented}
            destination={destination}
            handoffIdea={handoffIdea}
            brief={loaded.project.brief}
            onConsented={() => setConsented(true)}
            onConfirm={onIdeaConfirmed}
          />
        )}
        {step === "parts" && doc && (
          <PartsStep
            ctx={ctx}
            doc={doc}
            products={products}
            productsLoading={productsLoading}
            beforeServer={flushBeforeServer}
            onComponents={onComponents}
            onNext={next}
          />
        )}
        {step === "wiring" && doc && (
          <WiringStep ctx={ctx} doc={doc} beforeServer={flushBeforeServer} onWiring={onWiring} onNext={next} />
        )}
        {step === "enclosure" && doc && (
          <EnclosureStep ctx={ctx} doc={doc} beforeServer={flushBeforeServer} onEnclosure={onEnclosure} onNext={next} />
        )}
        {step === "code" && doc && <CodeStep ctx={ctx} doc={doc} onNext={next} />}
        {step === "make" && doc && <MakeStep ctx={ctx} doc={doc} products={products} />}
      </div>
    </div>
  );
}
