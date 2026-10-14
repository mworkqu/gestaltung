// Get Ready content config (Prompt 4 Step B). Structure only: every visible
// string lives in messages/cad-champions/{en,ar}/get-ready.json under the
// key paths built here (content.test.ts checks that each one exists in both
// languages). Order in arrays = display order.

import type { CcTrackSoftware } from "../db/types";
import type { VideoKey } from "../videos/registry";
import type { EssentialActionKey, GetReadyStepKey, TestDayCheckKey } from "./steps";

/** Help Center articles linked from Get Ready (built by the Help Center task). */
export const HELP_SLUGS = {
  howTheTestWorks: "how-the-free-test-works",
  whatYouNeed: "what-you-need-before-the-test",
  autodeskFree: "free-autodesk-software-for-students",
  onlyMac: "i-only-have-a-mac",
  noComputer: "i-dont-have-a-computer",
  exportStepInventor: "export-step-inventor",
  exportStepFusion: "export-step-fusion",
  exportStepSolidworks: "export-step-solidworks",
  unitsMm: "set-units-to-mm",
  materialDensity: "set-material-and-density",
  exportPdf: "export-drawing-pdf",
  rejected: "my-file-was-rejected",
  tooLarge: "my-file-is-too-large",
  wrongFile: "i-uploaded-the-wrong-file",
  realCompetition: "how-the-real-competition-works",
  resultsFolder: "results-folder-structure",
  projection: "first-vs-third-angle-projection",
  instruments: "allowed-measuring-instruments",
} as const;

/** Help article shown under each step. */
export const STEP_HELP_SLUG: Record<GetReadyStepKey, string> = {
  welcome_video: HELP_SLUGS.howTheTestWorks,
  check_computer: HELP_SLUGS.whatYouNeed,
  install_software: HELP_SLUGS.autodeskFree,
  essential_actions: HELP_SLUGS.rejected,
  practice_upload: HELP_SLUGS.rejected,
  try_test_screen: HELP_SLUGS.howTheTestWorks,
  test_day_checklist: HELP_SLUGS.whatYouNeed,
};

// ------------------------------------------------------------ step 1: video
export const WELCOME_VIDEO: VideoKey = "get_ready_welcome";
export const WELCOME_TAKEAWAYS = ["skills", "duration", "ownSoftware", "results"] as const;

// ---------------------------------------------------------- step 2: computer
export const REQUIREMENT_ROWS = ["os", "ram", "graphics", "mouse", "screen", "internet"] as const;
export const REQUIREMENT_COLUMNS = ["recommended", "minimum"] as const;
export const FIND_SPECS_STEPS = ["s1", "s2", "s3"] as const;

// ---------------------------------------------------------- step 3: software
export const SOFTWARE_TABS = ["inventor", "fusion", "solidworks", "other"] as const;
export type SoftwareTab = (typeof SOFTWARE_TABS)[number];

export interface SoftwareTabContent {
  recommended: boolean;
  /** Autodesk Education facts box. */
  autodesk: boolean;
  /** Message ids under software.<tab>.install */
  installSteps: readonly string[];
  /** Message ids under software.<tab>.trouble */
  troubleshooting: readonly string[];
  videoKey: VideoKey | null;
  helpSlug: string;
}

export const SOFTWARE_CONTENT: Record<SoftwareTab, SoftwareTabContent> = {
  inventor: {
    recommended: true,
    autodesk: true,
    installSteps: ["s1", "s2", "s3", "s4", "s5", "s6"],
    troubleshooting: ["t1", "t2", "t3"],
    videoKey: "install_inventor",
    helpSlug: HELP_SLUGS.autodeskFree,
  },
  fusion: {
    recommended: false,
    autodesk: true,
    installSteps: ["s1", "s2", "s3", "s4", "s5"],
    troubleshooting: ["t1", "t2", "t3"],
    videoKey: "install_fusion",
    helpSlug: HELP_SLUGS.onlyMac,
  },
  solidworks: {
    recommended: false,
    autodesk: false,
    installSteps: ["s1", "s2", "s3", "s4"],
    troubleshooting: ["t1", "t2"],
    videoKey: "install_solidworks",
    helpSlug: HELP_SLUGS.exportStepSolidworks,
  },
  other: {
    recommended: false,
    autodesk: false,
    installSteps: ["s1", "s2", "s3"],
    troubleshooting: ["t1"],
    videoKey: null,
    helpSlug: HELP_SLUGS.rejected,
  },
};

export const AUTODESK_FACTS = ["free", "year", "verify", "start"] as const;
export const AUTODESK_EDUCATION_URL = "https://www.autodesk.com/education";

/** The tab that opens first: the student's track (Inventor when unset). */
export function tabForTrack(track: CcTrackSoftware | null | undefined): SoftwareTab {
  return track === "fusion" || track === "solidworks" ? track : "inventor";
}

// ------------------------------------------------- step 4: essential actions
export const ACTION_SOFTWARE = ["inventor", "fusion", "solidworks"] as const;
export type ActionSoftware = (typeof ACTION_SOFTWARE)[number];

export interface EssentialActionContent {
  videoKey: VideoKey;
  helpSlug: string;
  /** Message ids under actions.items.<key>.steps.<software> */
  steps: Record<ActionSoftware, readonly string[]>;
}

export const ESSENTIAL_ACTIONS: Record<EssentialActionKey, EssentialActionContent> = {
  units_mm: {
    videoKey: "action_units_mm",
    helpSlug: HELP_SLUGS.unitsMm,
    steps: { inventor: ["s1", "s2", "s3"], fusion: ["s1", "s2", "s3"], solidworks: ["s1", "s2", "s3"] },
  },
  material_density: {
    videoKey: "action_material_density",
    helpSlug: HELP_SLUGS.materialDensity,
    steps: { inventor: ["s1", "s2", "s3", "s4"], fusion: ["s1", "s2", "s3", "s4"], solidworks: ["s1", "s2", "s3", "s4"] },
  },
  export_step: {
    videoKey: "action_export_step",
    helpSlug: HELP_SLUGS.exportStepInventor,
    steps: { inventor: ["s1", "s2", "s3", "s4"], fusion: ["s1", "s2", "s3"], solidworks: ["s1", "s2", "s3"] },
  },
  export_pdf: {
    videoKey: "action_export_pdf",
    helpSlug: HELP_SLUGS.exportPdf,
    steps: { inventor: ["s1", "s2", "s3"], fusion: ["s1", "s2", "s3"], solidworks: ["s1", "s2", "s3"] },
  },
  find_upload: {
    videoKey: "action_find_upload",
    helpSlug: HELP_SLUGS.wrongFile,
    steps: { inventor: ["s1", "s2", "s3"], fusion: ["s1", "s2", "s3"], solidworks: ["s1", "s2", "s3"] },
  },
};

/** The export-STEP help article per software. */
export const EXPORT_STEP_HELP: Record<ActionSoftware, string> = {
  inventor: HELP_SLUGS.exportStepInventor,
  fusion: HELP_SLUGS.exportStepFusion,
  solidworks: HELP_SLUGS.exportStepSolidworks,
};

export function actionSoftwareFor(track: CcTrackSoftware | null | undefined): ActionSoftware {
  return track === "fusion" || track === "solidworks" ? track : "inventor";
}

// ---------------------------------------------------- step 5: practice upload
export const PRACTICE_BUCKET = "cc-submissions";
export const PRACTICE_PASS_RULES = ["valid", "single", "units", "volume"] as const;

// ------------------------------------------------------ step 6: test screen demo
export const DEMO_SECONDS = 5 * 60;
export const DEMO_COACH_MARKS = ["timer", "tasks", "brief", "upload", "submit"] as const;
export type DemoCoachMark = (typeof DEMO_COACH_MARKS)[number];
export const DEMO_TASKS = ["t1", "t2", "t3"] as const;

// --------------------------------------------------- step 7: test-day checklist
export const TEST_DAY_ITEMS: readonly TestDayCheckKey[] = [
  "time_90",
  "charged",
  "close_apps",
  "cad_ready",
  "know_exports",
  "upload_each",
  "work_alone",
];

// -------------------------------------------------------- message key paths
// Every key the Get Ready UI builds dynamically, relative to CC.get-ready.
// content.test.ts asserts each exists in en and ar.
export function dynamicMessageKeys(): string[] {
  const keys: string[] = [];
  const steps: GetReadyStepKey[] = [
    "welcome_video",
    "check_computer",
    "install_software",
    "essential_actions",
    "practice_upload",
    "try_test_screen",
    "test_day_checklist",
  ];
  for (const s of steps) keys.push(`steps.${s}.title`, `steps.${s}.purpose`);
  for (const k of WELCOME_TAKEAWAYS) keys.push(`welcome.takeaways.${k}`);
  for (const r of REQUIREMENT_ROWS) {
    keys.push(`computer.rows.${r}.label`);
    for (const c of REQUIREMENT_COLUMNS) keys.push(`computer.rows.${r}.${c}`);
  }
  for (const s of FIND_SPECS_STEPS) keys.push(`computer.findSpecs.${s}`);
  for (const tab of SOFTWARE_TABS) {
    const c = SOFTWARE_CONTENT[tab];
    keys.push(`software.${tab}.name`, `software.${tab}.suits`, `software.${tab}.platforms`, `software.${tab}.howToGet`, `software.${tab}.duration`);
    for (const s of c.installSteps) keys.push(`software.${tab}.install.${s}`);
    for (const t of c.troubleshooting) keys.push(`software.${tab}.trouble.${t}`);
  }
  for (const f of AUTODESK_FACTS) keys.push(`software.autodesk.${f}`);
  for (const [action, c] of Object.entries(ESSENTIAL_ACTIONS)) {
    keys.push(`actions.items.${action}.title`, `actions.items.${action}.why`, `actions.items.${action}.mistake`);
    for (const sw of ACTION_SOFTWARE) for (const s of c.steps[sw]) keys.push(`actions.items.${action}.steps.${sw}.${s}`);
  }
  for (const sw of ACTION_SOFTWARE) keys.push(`actions.software.${sw}`);
  for (const r of PRACTICE_PASS_RULES) keys.push(`practice.rules.${r}`);
  for (const m of DEMO_COACH_MARKS) keys.push(`demo.coach.${m}.title`, `demo.coach.${m}.body`);
  for (const t of DEMO_TASKS) keys.push(`demo.tasks.${t}.title`, `demo.tasks.${t}.status`);
  for (const i of TEST_DAY_ITEMS) keys.push(`checklist.items.${i}`);
  for (const r of ["ready", "bypassed", "not_finished", "no_profile"]) keys.push(`gate.${r}`);
  return keys;
}
