"use client";

// Design Studio (P5-13 Phase 1): one flow, one step card at a time.
//
//  * The StudioDoc (projects.studio, migration 0068) is loaded through the
//    StudioApi (GET /api/studio/doc). Before 0068 runs the route answers
//    run_0068 and the doc simply lives in memory (persist = false).
//  * Saving: use-studio-save.ts. Steps and ?step=: use-studio-navigation.ts.
//    What each step reports back: use-studio-handlers.ts.

import { skusFor } from "@/lib/studio/variants";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { AuthReturnLink } from "@/components/auth/auth-return-link";
import { chatStorageKey, parseHandoff } from "@/lib/projects/create-from-chat";
import type { LibraryPart, StudioDoc } from "@/lib/studio/schema";
import { StudioLibraryProvider, useStudioLibrary } from "./StudioLibraryProvider";
import { fileSlug } from "@/lib/studio/client/steps";
import { useProductPreviews, useUnlockedProduct } from "./use-product";
import type { StoreCardPart } from "@/lib/store/catalog";
import { withStudioCache } from "@/lib/studio/client/cache";
import { liveStudioApi, type LoadResult, type Locale, type StudioApi, type StudioProject } from "@/lib/studio/client/api";
import {
  FLOW,
  initialStep,
  stepDone,
  stepFaded,
  stepFadedReasonKey,
  type FlowStep,
} from "@/lib/studio/client/steps";
import { ProgressLine } from "./ProgressLine";
import { DeleteProject } from "./DeleteProject";
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
import type { StudioCtx } from "./studio-ctx";
import { asLocale } from "@/lib/locale";
import { useStudioSave } from "./use-studio-save";
import { useStudioNavigation, useStudioSteps } from "./use-studio-navigation";
import { useStudioHandlers } from "./use-studio-handlers";
import { ClassBanner, FadedBanner, StepSlide } from "./studio-banners";

export type { StudioCtx } from "./studio-ctx";

type Loaded =
  | { state: "loading" }
  | { state: "error"; error: "sign_in" | "not_found" | "failed" }
  | { state: "ready"; project: StudioProject };

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
  /**
   * 3c/3d: set when this project belongs to a school class team (read on the
   * server). Safety mode is on, and the project never asks the team for a
   * phone number or an email, never offers checkout and never shows "Get it
   * made" — their teacher orders the parts.
   */
  classTeam?: { teamName: string; className: string } | null;
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
  classTeam = null,
}: ShellProps) {
  const t = useTranslations("Studio");
  const tSafe = useTranslations("SchoolSafety");
  const { getPart } = useStudioLibrary();
  const locale: Locale = asLocale(useLocale());
  // W8: repeat chat turns / picks for the same spec come from the tab cache, never the model.
  const api = useMemo(() => withStudioCache(injected ?? liveStudioApi(projectId)), [injected, projectId]);

  const [loaded, setLoaded] = useState<Loaded>(() => (initial ? { state: "ready", project: initial.project } : { state: "loading" }));
  const steps = useStudioSteps(initial, requestedStep);
  const { current } = steps;
  const [handoffIdea, setHandoffIdea] = useState<string | null>(null);
  const [consented, setConsented] = useState(initial?.project.consented ?? false);

  // Opened from /projects/new: the first chat message waits in sessionStorage.
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
  const { doc, latest, version, persist, status, guest, flush, commit } = useStudioSave({
    api,
    initial,
    load: {
      onInitial: pickUpHandoff,
      onError: (error) => setLoaded({ state: "error", error }),
      onLoaded: (r) => {
        setConsented(r.project.consented);
        pickUpHandoff(r.doc);
        steps.startAt(initialStep(r.doc, requestedStep));
        setLoaded({ state: "ready", project: r.project });
      },
    },
  });

  const ready = loaded.state === "ready";
  const { furthest, go, next } = useStudioNavigation({ steps, doc, latest, commit, flush, ready });

  // ── Store products for the parts (shared by Parts and Make) ──────────────
  const skus = useMemo(
    () => [...new Set((doc?.components ?? []).flatMap((c) => skusFor(getPart(c.partId), c.variant)))].sort().join(","),
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
  const {
    onIdeaConfirmed,
    onIdeaDraft,
    onComponents,
    onWiring,
    onEnclosure,
    onMech,
    onFirmware,
    flushBeforeServer,
    wireFocus,
    showInCode,
    showInWiring,
    onWiringTicks,
    onProduct,
    onProductFinish,
  } = useStudioHandlers({ api, latest, version, commit, flush, go, getPart });
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
    [unlockedHash, latest],
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
  }, [api.mode, commit, flush, latest, projectId, router]);

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
  // W2: one "Get it made" bar from the Enclosure step onward. 3c: never in a
  // class project — a team is never asked for a name, a phone number or an
  // email, and never sends a quote request; their teacher orders the parts.
  const showGetItMade = !classTeam && !!doc && current >= FLOW.indexOf("enclosure");

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
      {classTeam && (
        <ClassBanner
          teamName={classTeam.teamName}
          label={tSafe("classLabel", { team: classTeam.teamName })}
          banner={tSafe("banner")}
          more={tSafe("bannerMore")}
          breadboard={step === "wiring" || step === "print" || step === "code" ? tSafe("breadboard") : null}
        />
      )}
      <ProgressLine
        current={current}
        furthest={furthest}
        done={(s) => stepDone(s, doc)}
        faded={(s) => stepFaded(s, doc)}
        onGo={go}
        status={doc && persist.current ? <SaveIndicator status={status} guest={guest} onRetry={() => void flush()} /> : null}
      />
      <StepSlide index={current}>
        {doc && stepFaded(step, doc) && (
          <FadedBanner
            reason={t(stepFadedReasonKey(step, doc) ?? "fadedLogic")}
            title={t("fadedTitle")}
            continueLabel={t("fadedContinue")}
            onContinue={next}
            last={current >= FLOW.length - 1}
          />
        )}
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
            onDraft={onIdeaDraft}
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
        {step === "make" && doc && (
          <MakeStep ctx={ctx} doc={doc} products={products} engine={engine} pictureUrl={chosenPicture} isClass={!!classTeam} />
        )}
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
      {doc && persist.current && api.mode !== "mock" && <DeleteProject projectId={projectId} />}
    </div>
  );
}
