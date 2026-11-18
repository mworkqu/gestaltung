// Help Center categories and the article slugs the content seed provides.
// Category ids are the URL-safe form; normalizeHelpCategory() also accepts the
// underscore spellings used in the schema comment (files_export, ...).

import { BookOpen, CreditCard, FileOutput, Timer, Trophy, UserCircle, type LucideIcon } from "lucide-react";

export const HELP_CATEGORY_IDS = [
  "getting-started",
  "files-and-export",
  "the-test",
  "training-and-payment",
  "account",
  "competition",
] as const;

export type HelpCategoryId = (typeof HELP_CATEGORY_IDS)[number];

export interface HelpCategory {
  id: HelpCategoryId;
  icon: LucideIcon;
  /** Message keys live under CC.help: categories.<id>.title / .description */
  titleKey: string;
  descriptionKey: string;
  /** Article slugs the content seed creates, in display order. */
  slugs: readonly string[];
}

function cat(id: HelpCategoryId, icon: LucideIcon, slugs: readonly string[]): HelpCategory {
  return { id, icon, titleKey: `categories.${id}.title`, descriptionKey: `categories.${id}.description`, slugs };
}

export const HELP_CATEGORIES: readonly HelpCategory[] = [
  cat("getting-started", BookOpen, [
    "how-the-free-test-works",
    "what-you-need-before-the-test",
    "free-autodesk-software-for-students",
    "i-only-have-a-mac",
    "i-dont-have-a-computer",
  ]),
  cat("files-and-export", FileOutput, [
    "export-step-inventor",
    "export-step-fusion",
    "export-step-solidworks",
    "set-units-to-mm",
    "set-material-and-density",
    "export-drawing-pdf",
    "my-file-was-rejected",
    "my-file-is-too-large",
    "i-uploaded-the-wrong-file",
  ]),
  cat("the-test", Timer, [
    "timer-rules",
    "what-if-my-internet-drops",
    "can-i-retake-the-test",
    "how-grading-works",
    "what-does-my-skill-level-mean",
    "why-is-my-score-provisional",
  ]),
  cat("training-and-payment", CreditCard, [
    "whats-included-in-the-training",
    "how-to-pay-with-fawran",
    "how-long-until-payment-is-approved",
    "refunds",
  ]),
  cat("account", UserCircle, [
    "changing-my-email-or-password",
    "i-didnt-get-the-verification-email",
    "deleting-my-account",
    "privacy",
  ]),
  cat("competition", Trophy, [
    "how-the-real-competition-works",
    "results-folder-structure",
    "first-vs-third-angle-projection",
    "allowed-measuring-instruments",
  ]),
];

const ALIASES: Record<string, HelpCategoryId> = {
  getting_started: "getting-started",
  files_export: "files-and-export",
  files_and_export: "files-and-export",
  the_test: "the-test",
  training_payment: "training-and-payment",
  training_and_payment: "training-and-payment",
};

/** Maps a stored cc_help_articles.category to a known category id, or null. */
export function normalizeHelpCategory(raw: string | null | undefined): HelpCategoryId | null {
  const v = (raw ?? "").trim().toLowerCase();
  if ((HELP_CATEGORY_IDS as readonly string[]).includes(v)) return v as HelpCategoryId;
  return ALIASES[v] ?? null;
}

export function getHelpCategory(id: HelpCategoryId): HelpCategory {
  return HELP_CATEGORIES.find((c) => c.id === id)!;
}
