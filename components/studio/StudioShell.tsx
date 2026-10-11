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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { AuthReturnLink } from "@/components/auth/auth-return-link";
import { chatStorageKey, parseHandoff } from "@/lib/projects/create-from-chat";
import type { LibraryPart } from "@/lib/studio/schema";
import { StudioLibraryProvider, useStudioLibrary } from "./StudioLibraryProvider";
import {
  emptyStudioDoc,
  type EnclosureSpec,
  type Finish,
  type MechPart,
  type ProductSpec,
  type StudioComponent,
  type StudioDoc,
  type StudioProduct,
} from "@/lib/studio/schema";
import { fileSlug } from "@/lib/studio/client/steps";
import { PRODUCT_FINISH_KEY, useProductPreviews, useUnlockedProduct } from "./use-product";
import type { StoreCardPart } from "@/lib/store/catalog";
import { withStudioCache } from "@/lib/studio/client/cache";
import { liveStudioApi, type LoadResult, type Locale, type StudioApi, type StudioProject } from "@/lib/studio/client/api";
import {
  FLOW,
  PASS_ONLY,
  furthestStep,
  initialStep,
  markPassed,
  passedAnswers,
  sameSpec,
  stepDone,
  type FlowStep,
} from "@/lib/studio/client/steps";
import { saveStatus, shouldWarnOnLeave, stepChangeSave, type SaveStatus } from "@/lib/studio/client/save-state";
import { ProgressLine } from "./ProgressLine";
import { SaveIndicator } from "./SaveIndicator";
import { Bar, MainButton } from "./ui";
import { GET_IT_MADE_PARAM, GetItMade } from "./GetItMade";
import { REQUEST_SENT_KEY } from "@/lib/studio/request-summary";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { IdeaStep } from "./steps/IdeaStep";
import { PartsStep } from "./steps/PartsStep";
import { WiringStep } from "./steps/WiringStep";
import { EnclosureStep, productFlowOf } from "./steps/EnclosureStep";
import { PrintStep } from "./steps/PrintStep";
import { CodeStep } from "./steps/CodeStep";
import { MakeStep } from "./steps/MakeStep";

export type StudioCtx = {
  api: StudioApi;
  locale: Locale;
  projectId: string;
  projectName: string;
  /** Step number (1-based) and accent come from the step id. */
  n: (step: FlowStep) => number;
  /** super_admin (checked on the server): the Engineer view of the product designs. */
  isAdmin?: boolean;
};

type Loaded =
  | { state: "loading" }
  | { state: "error"; error: "sign_in" | "not_found" | "failed" }
  | { state: "ready"; project: StudioProject };

const SAVE_DELAY_MS = 700;
const RETRY_DELAY_MS = 8000;

type ShellProps = {
  projectId: string;
  /** Where the idea goes (providerStatus().destination), for the consent line. */
  destination: string;
  /** Opened from /projects/new: carry on with the first message. */
  startChat?: boolean;
  requestedStep?: string | null;
  /** Test fixture only: a mock StudioApi. */
  api?: StudioApi;
  /**
   * The first load, already read on the server (lib/studio/server/initial.ts): the step renders
   * straight away (server HTML), no client load. Absent = the browser loads it (skeleton first).
   */
  initial?: Extract<LoadResult, { ok: true }> | null;
  /** super_admin (checked on the server page): Engineer view of the product designs. */
  isAdmin?: boolean;
};

/** Owner-edited / new library parts (studio_parts, validated on the server); none = the code library. */
export function StudioShell({ libraryParts, ...props }: ShellProps & { libraryParts?: LibraryPart[] }) {
  return (
    <StudioLibraryProvider overrides={libraryParts}>
      <StudioShellInner {...props} />
    </StudioLibraryProvider>
  );
}

function StudioShellInner({
  projectId,
  destination,
  startChat = false,
  requestedStep = null,
  api: injected,
  initial = null,
  isAdmin = false,
}: ShellProps) {
  const t = useTranslations("Studio");
  const { getPart } = useStudioLibrary();
  const locale: Locale = useLocale() === "ar" ? "ar" : "en";
  // W8: repeat chat turns / picks for the same spec come from the tab cache, never the model.
  const api = useMemo(() => withStudioCache(injected ?? liveStudioApi(projectId)), [injected, projectId]);

  // Read once: a server-provided first state is applied exactly as a client load would be.
  const [start0] = useState(() => (initial ? initialStep(initial.doc, requestedStep) : 0));
  const [loaded, setLoaded] = useState<Loaded>(() => (initial ? { state: "ready", project: initial.project } : { state: "loading" }));
  const [doc, setDoc] = useState<StudioDoc | null>(initial?.doc ?? null);
  const [current, setCurrent] = useState(start0);
  const currentRef = useRef(start0);
  const [visited, setVisited] = useState(start0);
  const [handoffIdea, setHandoffIdea] = useState<string | null>(null);
  const [consented, setConsented] = useState(initial?.project.consented ?? false);

  // Save machinery (refs: always the latest values inside async code).
  const latest = useRef<StudioDoc | null>(initial?.doc ?? null);
  const version = useRef(initial?.version ?? 0);
  const persist = useRef(initial?.persist ?? true);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  // D4: what the header indicator shows, and the same truth for the beforeunload guard.
  const inFlight = useRef(false);
  const failed = useRef(false);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const statusRef = useRef<SaveStatus>("saved");
  const [guest, setGuest] = useState(false);
  const refreshStatus = useCallback(() => {
    const next = saveStatus({ dirty: dirty.current && persist.current, inFlight: inFlight.current, failed: failed.current });
    statusRef.current = next;
    setStatus(next);
  }, []);

  const flush = useCallback((): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    chain.current = chain.current.then(async () => {
      if (!dirty.current || !persist.current || !latest.current) {
        refreshStatus();
        return;
      }
      dirty.current = false;
      inFlight.current = true;
      failed.current = false;
      refreshStatus();
      const r = await api.save(latest.current, version.current);
      inFlight.current = false;
      if (r.ok) version.current = r.version;
      else if (r.error === "conflict") {
        // Someone saved first (another tab): theirs wins, ours is dropped.
        version.current = r.version;
        if (r.doc) {
          latest.current = r.doc;
          setDoc(r.doc);
        }
      } else if (r.error === "run_0068") persist.current = false;
      else {
        // Network blip: keep the change, show "Not saved", and try again shortly.
        dirty.current = true;
        failed.current = true;
        if (!timer.current) timer.current = setTimeout(() => void flush(), RETRY_DELAY_MS);
      }
      refreshStatus();
    });
    return chain.current;
  }, [api, refreshStatus]);

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
      failed.current = false;
      refreshStatus();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush, refreshStatus],
  );

  // Load once (skipped when the server already did; the /projects/new hand-off still runs here).
  const [initialUsed] = useState(() => initial);
  useEffect(() => {
    let alive = true;
    const pickUpHandoff = (doc: StudioDoc | null) => {
      if (!startChat || doc) return;
      try {
        const key = chatStorageKey(projectId);
        const h = parseHandoff(sessionStorage.getItem(key));
        sessionStorage.removeItem(key);
        const first = h?.messages.find((m) => m.role === "user")?.text ?? null;
        if (first) setHandoffIdea(first);
      } catch {
        /* storage blocked: the chat starts empty */
      }
    };
    if (initialUsed) {
      pickUpHandoff(initialUsed.doc);
      return;
    }
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
      pickUpHandoff(r.doc);
      const start = initialStep(r.doc, requestedStep);
      setCurrent(start);
      currentRef.current = start;
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
    // D4: while a change is unsaved (pending, in flight or failed) the browser asks before closing.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!shouldWarnOnLeave(statusRef.current, persist.current)) return;
      void flush();
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Leaving through an in-app link (Dashboard, header): save what is pending.
      void flush();
    };
  }, [flush]);

  // Guests are saved on this device's session: the indicator says so.
  useEffect(() => {
    let alive = true;
    void api.isGuest?.().then((g) => alive && setGuest(g)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [api]);

  const furthest = furthestStep(doc, visited);
  const go = useCallback(
    (i: number) => {
      const idx = Math.max(0, Math.min(FLOW.length - 1, i));
      // Leaving Code / Make forwards is what makes them "done" (they have no data of their own).
      const leaving = FLOW[currentRef.current];
      const base = latest.current;
      if (base && idx > currentRef.current && (PASS_ONLY as readonly string[]).includes(leaving)) {
        const answers = markPassed(base.answers, leaving);
        if (answers !== base.answers) commit({ ...base, answers });
      }
      // W1: remember the step on the doc, so the project reopens here (any device, after sign-in).
      const stepSave = stepChangeSave(latest.current, FLOW[idx]);
      if (stepSave.save && stepSave.doc) commit(stepSave.doc);
      currentRef.current = idx;
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
    [flush, commit],
  );
  const next = useCallback(() => go(current + 1), [go, current]);

  // W1: the URL always names the open step (?step=), so a sign-in link taken from
  // here returns to exactly this step, even before the visitor moved.
  const ready = loaded.state === "ready";
  useEffect(() => {
    if (!ready) return;
    try {
      const url = new URL(window.location.href);
      const step = FLOW[currentRef.current];
      if (url.searchParams.get("step") === step) return;
      url.searchParams.set("step", step);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      /* no URL update: fine */
    }
  }, [ready]);

  // ── Store products for the parts (shared by Parts and Make) ──────────────
  const skus = useMemo(
    () => (doc?.components ?? []).flatMap((c) => getPart(c.partId)?.storeSkus ?? []).sort().join(","),
    [doc?.components, getPart],
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
        ? { ...base, answers: { ...passedAnswers(base.answers), ...answers } }
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
            firmware: undefined,
            product: undefined,
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
            {
              ...base,
              components,
              netlist: { nets: [] },
              checks: [],
              layout: [],
              mech: [],
              // P5-17: same board → the client's code stays; the Code step swaps only its pin block.
              firmware: sameBoard(base.components, components, getPart) ? base.firmware : undefined,
            }
          : { ...base, components },
        edited ? undefined : serverVersion,
      );
    },
    [commit, getPart],
  );

  const onWiring = useCallback(
    (w: { components: StudioComponent[]; netlist: StudioDoc["netlist"]; checks: StudioDoc["checks"] }, serverVersion: number | null) => {
      const base = latest.current;
      if (!base) return;
      // A different circuit on the same board keeps the code (the Code step updates only the
      // pin block, P5-17); another board drops it.
      const same =
        !base.firmware ||
        JSON.stringify(base.netlist) === JSON.stringify(w.netlist) ||
        sameBoard(base.components, w.components, getPart);
      if (same) {
        commit({ ...base, components: w.components, netlist: w.netlist, checks: w.checks }, serverVersion);
        return;
      }
      // The route saved the circuit; dropping the code is ours to save on top of it.
      if (typeof serverVersion === "number") version.current = serverVersion;
      commit({ ...base, components: w.components, netlist: w.netlist, checks: w.checks, firmware: undefined });
    },
    [commit, getPart],
  );

  const onEnclosure = useCallback(
    (
      enclosure: EnclosureSpec,
      opts: { serverVersion?: number | null; fresh?: boolean; layout?: StudioDoc["layout"]; reshape?: boolean },
    ) => {
      const base = latest.current;
      if (!base) return;
      const versions = opts.fresh ? [...(base.enclosureVersions ?? []), enclosure].slice(-3) : base.enclosureVersions;
      // A new look (or another shape picked under "Other shapes") changes the case's size:
      // its printed parts are worked out again.
      const nextDoc: StudioDoc = {
        ...base,
        enclosure,
        enclosureVersions: versions,
        layout: opts.layout ?? base.layout,
        ...(opts.fresh || opts.reshape ? { mech: [] } : {}),
      };
      if (opts.fresh && typeof opts.serverVersion === "number") {
        // The route saved the enclosure; the layout is ours to add.
        version.current = opts.serverVersion;
      }
      commit(nextDoc);
    },
    [commit],
  );

  const onMech = useCallback(
    (mech: MechPart[], serverVersion: number | null) => {
      const base = latest.current;
      if (!base) return;
      commit({ ...base, mech }, serverVersion);
    },
    [commit],
  );

  const onFirmware = useCallback(
    (firmware: { board: string; code: string }, serverVersion: number | null) => {
      const base = latest.current;
      if (!base) return;
      commit({ ...base, firmware }, serverVersion);
    },
    [commit],
  );

  const flushBeforeServer = useCallback(() => flush(), [flush]);

  // ── P5-17 wiring views ↔ code: one wire highlighted across steps ─────────
  const [wireFocus, setWireFocus] = useState<{ id: string; step: "wiring" | "code"; n: number } | null>(null);
  const showInCode = useCallback(
    (id: string) => {
      setWireFocus((f) => ({ id, step: "code", n: (f?.n ?? 0) + 1 }));
      go(FLOW.indexOf("code"));
    },
    [go],
  );
  const showInWiring = useCallback(
    (id: string) => {
      setWireFocus((f) => ({ id, step: "wiring", n: (f?.n ?? 0) + 1 }));
      go(FLOW.indexOf("wiring"));
    },
    [go],
  );
  const onWiringTicks = useCallback(
    (wiringTicks: string[]) => {
      const base = latest.current;
      if (!base) return;
      commit({ ...base, wiringTicks });
    },
    [commit],
  );

  // ── P5-16 product designs (pictures in the background after Parts) ───────
  const onProduct = useCallback(
    (update: (prev: StudioProduct | undefined) => StudioProduct) => {
      const base = latest.current;
      if (!base) return;
      commit({ ...base, product: update(base.product) });
    },
    [commit],
  );
  const onProductFinish = useCallback(
    (finish: Finish) => {
      const base = latest.current;
      if (!base) return;
      commit({ ...base, answers: { ...(base.answers ?? {}), [PRODUCT_FINISH_KEY]: finish } });
    },
    [commit],
  );
  const previews = useProductPreviews({ api, doc, getPart, active: current > FLOW.indexOf("parts"), onProduct });
  const unlocked = useUnlockedProduct({ api, doc, getPart, active: current >= FLOW.indexOf("enclosure") });
  // "Get it made" for an unlocked product sends every printed body as an STL.
  const unlockedHash = unlocked.data?.hash ?? null;
  const productFiles = useMemo(
    () =>
      unlockedHash
        ? async () => {
            const { productStls } = await import("@/lib/studio/client/product");
            const r = await productStls(unlockedHash, fileSlug(latest.current?.spec.name ?? "product"));
            return r.files.map((f) => ({ name: f.name, data: f.data }));
          }
        : undefined,
    [unlockedHash],
  );

  // ── W2 "Get it made" ─────────────────────────────────────────────────────
  const router = useRouter();
  // Back from sign-in / sign-up with ?getItMade=1: reopen the pop-up once and drop the flag.
  const [reopenGetItMade, setReopenGetItMade] = useState(false);
  useEffect(() => {
    if (!ready) return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get(GET_IT_MADE_PARAM) !== "1") return;
      url.searchParams.delete(GET_IT_MADE_PARAM);
      window.history.replaceState(window.history.state, "", url.toString());
      setReopenGetItMade(true);
    } catch {
      /* no URL: the visitor opens it by hand */
    }
  }, [ready]);
  const onRequestSent = useCallback(async () => {
    const base = latest.current;
    if (base) commit({ ...base, answers: { ...(base.answers ?? {}), [REQUEST_SENT_KEY]: new Date().toISOString() } });
    await flush();
    // The e2e fixture has no project row: its own quote page renders a canned doc.
    router.push(api.mode === "mock" ? "/e2e-fixtures/studio-request" : `/projects/${projectId}/request`);
  }, [api.mode, commit, flush, projectId, router]);

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
          <AuthReturnLink className="inline-flex min-h-11 items-center font-semibold text-cobalt hover:text-cobalt-hover">
            {t("signIn")}
          </AuthReturnLink>
        ) : (
          <MainButton onClick={() => window.location.reload()}>{t("tryAgain")}</MainButton>
        )}
      </div>
    );
  }

  const projectName = doc?.spec.name ?? loaded.project.name;
  const step = FLOW[current];
  const n = (s: FlowStep) => FLOW.indexOf(s) + 1;
  const ctx: StudioCtx = { api, locale, projectId, projectName, n, isAdmin };
  // Owner 2026-10-11: the main-thread 3D engine only once the design has its CAD (or in
  // the template enclosure flow, which has always been 3D). Never for pictures / parts.
  const engine = !!doc && (!!doc.product?.unlockedId || productFlowOf(doc, previews) !== "product");
  const chosenId = doc?.product?.chosenId ?? null;
  const chosenPicture = previews.cards.find((c) => c.id === chosenId && c.url)?.url ?? previews.cards.find((c) => c.url)?.url ?? null;
  // W2: one "Get it made" bar from the Enclosure step onward.
  const showGetItMade = !!doc && current >= FLOW.indexOf("enclosure");

  return (
    <div
      className={cn(
        "space-y-5",
        // Phones: room for the fixed bar, and each step's own sticky button sits just above it.
        showGetItMade && "max-sm:pb-24 max-sm:[&_.sticky]:bottom-[calc(4.75rem+env(safe-area-inset-bottom))]",
      )}
      data-testid="studio-shell"
      data-step={step}
    >
      <ProgressLine
        current={current}
        furthest={furthest}
        done={(s) => stepDone(s, doc)}
        onGo={go}
        status={doc && persist.current ? <SaveIndicator status={status} guest={guest} onRetry={() => void flush()} /> : null}
      />
      <StepSlide index={current}>
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
          <WiringStep
            ctx={ctx}
            doc={doc}
            beforeServer={flushBeforeServer}
            onWiring={onWiring}
            onNext={next}
            focusId={wireFocus?.step === "wiring" ? wireFocus.id : null}
            onTicks={onWiringTicks}
            onShowInCode={showInCode}
          />
        )}
        {step === "enclosure" && doc && (
          <EnclosureStep
            ctx={ctx}
            doc={doc}
            previews={previews}
            unlocked={unlocked}
            beforeServer={flushBeforeServer}
            onEnclosure={onEnclosure}
            onProduct={onProduct}
            onFinish={onProductFinish}
            onNext={next}
          />
        )}
        {step === "print" && doc && (
          <PrintStep ctx={ctx} doc={doc} unlocked={unlocked} beforeServer={flushBeforeServer} onMech={onMech} onNext={next} />
        )}
        {step === "code" && doc && (
          <CodeStep
            ctx={ctx}
            doc={doc}
            beforeServer={flushBeforeServer}
            onFirmware={onFirmware}
            onNext={next}
            onWiring={() => go(FLOW.indexOf("wiring"))}
            focusId={wireFocus?.step === "code" ? wireFocus.id : null}
            onShowInWiring={showInWiring}
          />
        )}
        {step === "make" && doc && <MakeStep ctx={ctx} doc={doc} products={products} engine={engine} pictureUrl={chosenPicture} />}
      </StepSlide>
      {showGetItMade && doc && (
        <GetItMade
          api={api}
          doc={doc}
          locale={locale}
          autoOpen={reopenGetItMade}
          productFiles={productFiles}
          beforeLeave={() => void flush()}
          onSent={onRequestSent}
        />
      )}
    </div>
  );
}

/**
 * Step change: the new card slides in from the side it comes from (forwards = from the
 * reading end, back = from the start; mirrored in Arabic) while fading in. Web
 * Animations only (nothing left behind on the element), skipped with reduced motion.
 */
function StepSlide({ index, children }: { index: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef(index);
  useLayoutEffect(() => {
    const el = ref.current;
    const from = prev.current;
    prev.current = index;
    if (!el || from === index || typeof el.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    const dx = (index > from ? 1 : -1) * (rtl ? -1 : 1) * 28;
    el.animate(
      [
        { opacity: 0, transform: `translateX(${dx}px)` },
        { opacity: 1, transform: "translateX(0)" },
      ],
      { duration: 340, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
    );
  }, [index]);
  return <div ref={ref}>{children}</div>;
}

/** P5-17: the same main board (MCU part) before and after a change — the client's code still fits. */
function sameBoard(a: StudioComponent[], b: StudioComponent[], getPart: (id: string) => LibraryPart | undefined): boolean {
  const board = (cs: StudioComponent[]) => cs.find((c) => getPart(c.partId)?.category === "mcu")?.partId ?? null;
  const x = board(a);
  return x !== null && x === board(b);
}
