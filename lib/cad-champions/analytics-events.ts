// CAD Champions analytics event names and their typed props.

export const CC_EVENTS = {
  languageSwitched: "cc_language_switched",
  needHelpOpened: "cc_need_help_opened",
  needHelpWhatsapp: "cc_need_help_whatsapp",
  needHelpEmail: "cc_need_help_email",
  needHelpSearch: "cc_need_help_search",
  toastShown: "cc_toast_shown",
  // Landing page (Prompt 3)
  landingHeroCta: "cc_landing_hero_cta",
  landingFinalCta: "cc_landing_final_cta",
  landingFaqOpen: "cc_landing_faq_open",
  landingWhatsapp: "cc_landing_whatsapp",
  // Test flow (Prompt 5)
  testStarted: "cc_test_started",
  testFileSaved: "cc_test_file_saved",
  testSubmitted: "cc_test_submitted",
} as const;

export type CcEventName = (typeof CC_EVENTS)[keyof typeof CC_EVENTS];

export interface CcEventProps {
  cc_language_switched: { from: string; to: string };
  cc_need_help_opened: { page: string };
  cc_need_help_whatsapp: { page: string };
  cc_need_help_email: { page: string };
  cc_need_help_search: { page: string };
  cc_toast_shown: { tone: "success" | "error" | "info" };
  cc_landing_hero_cta: { signed_in: boolean };
  cc_landing_final_cta: { signed_in: boolean };
  cc_landing_faq_open: { id: string };
  cc_landing_whatsapp: { where: "need" | "final" };
  cc_test_started: { slug: string };
  cc_test_file_saved: { replaced: boolean };
  cc_test_submitted: { reason: "manual" | "timeout" };
}
