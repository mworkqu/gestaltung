// CAD Champions row types for every cc_ table, view and helper in
// supabase/migrations/0077_cc_core.sql.
//
// HAND-MAINTAINED: keep in sync with the SQL. Regenerate with
// `supabase gen types typescript` when CLI/database access is available.
//
// Conventions: timestamptz / date -> ISO string; numeric / bigint -> number
// (PostgREST returns JSON numbers); jsonb -> Json; nullable columns -> `| null`.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Uuid = string;
type Timestamp = string;
type DateString = string; // yyyy-mm-dd

// ---------------------------------------------------------------- enums
export const CC_ROLES = ["student", "instructor", "admin"] as const;
export type CcRole = (typeof CC_ROLES)[number];

export const CC_LOCALES = ["en", "ar"] as const;
export type CcLocale = (typeof CC_LOCALES)[number];

export const CC_STUDY_LEVELS = ["secondary", "diploma", "bachelor", "graduate", "working"] as const;
export type CcStudyLevel = (typeof CC_STUDY_LEVELS)[number];

export const CC_CAD_SOFTWARE_USED = ["inventor", "fusion", "solidworks", "other", "none"] as const;
export type CcCadSoftwareUsed = (typeof CC_CAD_SOFTWARE_USED)[number];

/** Priority order: Inventor (competition software, default), Fusion, SOLIDWORKS. */
export const CC_TRACK_SOFTWARE = ["inventor", "fusion", "solidworks"] as const;
export type CcTrackSoftware = (typeof CC_TRACK_SOFTWARE)[number];

export const CC_CAD_EXPERIENCE = ["none", "lt_6m", "6_24m", "gt_2y"] as const;
export type CcCadExperience = (typeof CC_CAD_EXPERIENCE)[number];

export const CC_COMPUTER_ACCESS = ["yes", "mac_only", "no_computer"] as const;
export type CcComputerAccess = (typeof CC_COMPUTER_ACCESS)[number];

export const CC_TEST_TYPES = ["practice", "diagnostic", "exercise", "mock", "qualifier"] as const;
export type CcTestType = (typeof CC_TEST_TYPES)[number];

export const CC_EXPECTED_UPLOADS = ["step", "pdf", "image", "video", "none"] as const;
export type CcExpectedUpload = (typeof CC_EXPECTED_UPLOADS)[number];

export const CC_GRADING_MODES = ["auto_step", "ai_drawing", "manual"] as const;
export type CcGradingMode = (typeof CC_GRADING_MODES)[number];

export const CC_GRADER_MODES = ["part", "assembly", "practice"] as const;
export type CcGraderMode = (typeof CC_GRADER_MODES)[number];

export const CC_SUBMIT_REASONS = ["manual", "timeout", "admin"] as const;
export type CcSubmitReason = (typeof CC_SUBMIT_REASONS)[number];

export const CC_ATTEMPT_STATUSES = ["in_progress", "submitted", "grading", "provisional", "graded", "expired"] as const;
export type CcAttemptStatus = (typeof CC_ATTEMPT_STATUSES)[number];

export const CC_BANDS = ["beginner", "developing", "competitive", "competition_ready"] as const;
export type CcBand = (typeof CC_BANDS)[number];

export const CC_RESULT_STATUSES = ["pending", "auto", "ai_pending_review", "final", "error"] as const;
export type CcResultStatus = (typeof CC_RESULT_STATUSES)[number];

export const CC_GRADING_LOG_KINDS = ["step", "ai_drawing", "ai_translate"] as const;
export type CcGradingLogKind = (typeof CC_GRADING_LOG_KINDS)[number];

export const CC_INTEGRITY_KINDS = ["duplicate_sha256", "too_fast", "ip_change", "other"] as const;
export type CcIntegrityKind = (typeof CC_INTEGRITY_KINDS)[number];

export const CC_QUESTION_KINDS = ["lesson", "grade_query"] as const;
export type CcQuestionKind = (typeof CC_QUESTION_KINDS)[number];

export const CC_QUESTION_STATUSES = ["open", "answered"] as const;
export type CcQuestionStatus = (typeof CC_QUESTION_STATUSES)[number];

export const CC_DISCOUNT_TYPES = ["percent", "fixed"] as const;
export type CcDiscountType = (typeof CC_DISCOUNT_TYPES)[number];

export const CC_COHORT_STATUSES = ["draft", "open", "full", "closed", "completed"] as const;
export type CcCohortStatus = (typeof CC_COHORT_STATUSES)[number];

export const CC_PAYMENT_METHODS = ["fawran", "skipcash"] as const;
export type CcPaymentMethod = (typeof CC_PAYMENT_METHODS)[number];

export const CC_PAYMENT_STATUSES = [
  "awaiting_transfer",
  "proof_submitted",
  "paid",
  "rejected",
  "refunded",
  "expired",
  "cancelled",
] as const;
export type CcPaymentStatus = (typeof CC_PAYMENT_STATUSES)[number];

export const CC_ENROLLMENT_SOURCES = ["payment", "admin"] as const;
export type CcEnrollmentSource = (typeof CC_ENROLLMENT_SOURCES)[number];

export const CC_ENROLLMENT_STATUSES = ["active", "expired", "cancelled"] as const;
export type CcEnrollmentStatus = (typeof CC_ENROLLMENT_STATUSES)[number];

export const CC_DELETION_STATUSES = ["pending", "approved", "rejected"] as const;
export type CcDeletionStatus = (typeof CC_DELETION_STATUSES)[number];

export const CC_COMPETITION_MODULE_CODES = ["M1", "M2", "M3", "M4"] as const;
export type CcCompetitionModuleCode = (typeof CC_COMPETITION_MODULE_CODES)[number];

export const CC_UPLOAD_MODES = ["per_task", "module_package"] as const;
export type CcUploadMode = (typeof CC_UPLOAD_MODES)[number];

export const CC_ASPECT_TYPES = ["measurement", "judgement"] as const;
export type CcAspectType = (typeof CC_ASPECT_TYPES)[number];

export const CC_ASPECT_METHODS = ["auto_step", "ai_drawing", "trainer"] as const;
export type CcAspectMethod = (typeof CC_ASPECT_METHODS)[number];

/** Judgement scale: 0 below industry standard ... 3 wholly exceeds. */
export type CcJudgementScore = 0 | 1 | 2 | 3;

/** Skill area ids = codes 1-6 (cc_skill_areas.id). */
export type CcSkillAreaId = 1 | 2 | 3 | 4 | 5 | 6;

// ----------------------------------------------------- profiles, journey
export interface CcProfile {
  id: Uuid;
  email: string | null;
  full_name: string | null;
  full_name_ar: string | null;
  phone: string | null;
  institution: string | null;
  institution_other: string | null;
  study_level: CcStudyLevel | null;
  date_of_birth: DateString | null;
  /** Snapshot set by trigger on every write; live check = cc_is_minor(date_of_birth). */
  is_minor: boolean;
  guardian_name: string | null;
  guardian_phone: string | null;
  guardian_consent: boolean;
  /** Set by trigger (server clock) when guardian_consent turns true. */
  guardian_consent_at: Timestamp | null;
  cad_software_used: CcCadSoftwareUsed | null;
  /** Default 'inventor'. */
  track_software: CcTrackSoftware | null;
  cad_experience: CcCadExperience | null;
  has_windows_pc: CcComputerAccess | null;
  preferred_locale: CcLocale;
  /** Admin-only to change (trigger). */
  role: CcRole;
  marketing_consent: boolean;
  weekly_progress_email: boolean;
  onboarding_step: number;
  onboarding_completed_at: Timestamp | null;
  /** Admin-only. */
  get_ready_bypass: boolean;
  /** Set by trigger on cc_deletion_requests insert. */
  deletion_requested_at: Timestamp | null;
  last_active_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CcJourneyProgress {
  user_id: Uuid;
  profile_completed_at: Timestamp | null;
  get_ready_completed_at: Timestamp | null;
  practice_passed_at: Timestamp | null;
  first_test_submitted_at: Timestamp | null;
  results_viewed_at: Timestamp | null;
  sample_lesson_watched_at: Timestamp | null;
  enrolled_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CcGetReadyStep {
  user_id: Uuid;
  step_key: string;
  completed_at: Timestamp;
}

export interface CcSkillArea {
  id: CcSkillAreaId;
  code: CcSkillAreaId;
  slug: string;
  name_en: string;
  name_ar: string;
  weight_percent: number;
  description_en: string;
  description_ar: string;
}

export interface CcCompetitionModule {
  code: CcCompetitionModuleCode;
  position: number;
  name_en: string;
  name_ar: string;
  hours: number;
  summary_en: string;
  summary_ar: string;
  given_en: string | null;
  given_ar: string | null;
  deliverables_en: string | null;
  deliverables_ar: string | null;
  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

// ------------------------------------------------------------- tests
export interface CcTest {
  id: Uuid;
  slug: string;
  title_en: string;
  title_ar: string;
  type: CcTestType;
  time_limit_minutes: number | null;
  grace_seconds: number;
  is_published: boolean;
  admin_only: boolean;
  intro_en: string | null;
  intro_ar: string | null;
  rules_en: string | null;
  rules_ar: string | null;
  retake_cooldown_days: number;
  upload_mode: CcUploadMode;
  /** module_package: expected file name patterns per task id. */
  package_expectations: Json;
  created_by: Uuid | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CcAttachment {
  path: string;
  label_en?: string;
  label_ar?: string;
  kind?: string;
}

/** Full row: STAFF ONLY (students get no rows; use CcTestTaskPublic). */
export interface CcTestTask {
  id: Uuid;
  test_id: Uuid;
  position: number;
  skill_area_id: CcSkillAreaId;
  competition_module: CcCompetitionModuleCode | null;
  title_en: string;
  title_ar: string;
  brief_en: string | null;
  brief_ar: string | null;
  attachments: Json;
  expected_upload: CcExpectedUpload;
  max_points: number;
  grading_mode: CcGradingMode;
  grader_mode: CcGraderMode | null;
  reference_data: Json | null;
  rubric: Json | null;
  tolerances: Json | null;
  density_kg_m3: number | null;
  material_name_en: string | null;
  material_name_ar: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** View cc_test_tasks_public: no reference_data, rubric, tolerances or grader_mode. */
export type CcTestTaskPublic = Omit<CcTestTask, "reference_data" | "rubric" | "tolerances" | "grader_mode">;

export interface CcAttempt {
  id: Uuid;
  user_id: Uuid;
  test_id: Uuid;
  started_at: Timestamp;
  deadline_at: Timestamp | null;
  submitted_at: Timestamp | null;
  submit_reason: CcSubmitReason | null;
  status: CcAttemptStatus;
  total_score: number | null;
  max_score: number | null;
  percent: number | null;
  band: CcBand | null;
  graded_at: Timestamp | null;
  start_ip: string | null;
  start_user_agent: string | null;
  submit_ip: string | null;
  submit_user_agent: string | null;
  share_enabled: boolean;
  share_token: string | null;
  /** Admin-only flag: trainer-run studio session. */
  in_person: boolean;
  session_id: Uuid | null;
  phase_markers: CcPhaseMarker[];
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CcPhaseMarker {
  key: string; // e.g. "part_collected"
  at: Timestamp;
}

export interface CcSubmission {
  id: Uuid;
  attempt_id: Uuid;
  /** null = the attempt's module_package ZIP. */
  task_id: Uuid | null;
  user_id: Uuid;
  storage_path: string;
  file_name: string;
  file_size: number;
  mime_type: string | null;
  sha256: string | null;
  uploaded_at: Timestamp;
  replaced_count: number;
  package_manifest: Json | null;
}

export interface CcTaskResult {
  id: Uuid;
  submission_id: Uuid | null;
  attempt_id: Uuid;
  task_id: Uuid;
  user_id: Uuid;
  auto_score: number | null;
  ai_score: number | null;
  manual_score: number | null;
  final_score: number | null;
  max_points: number | null;
  status: CcResultStatus;
  needs_manual_review: boolean;
  error_code: string | null;
  help_slug: string | null;
  feedback_en: string | null;
  feedback_ar: string | null;
  /** Student-safe only (check names, pass/fail). Raw grader output lives in cc_grading_logs.response. */
  details: Json | null;
  reviewer_comment_en: string | null;
  reviewer_comment_ar: string | null;
  graded_by: Uuid | null;
  graded_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CcTaskAspect {
  id: Uuid;
  /** Exactly one of task_id / exercise_id is set. */
  task_id: Uuid | null;
  exercise_id: Uuid | null;
  position: number;
  description_en: string;
  description_ar: string;
  skill_area_id: CcSkillAreaId;
  competition_module: CcCompetitionModuleCode | null;
  type: CcAspectType;
  max_points: number;
  method: CcAspectMethod;
  /** null = all-or-nothing. Staff only. */
  partial_rule: Json | null;
  /** 'volume' | 'area' | 'inertia' | 'solids' | `rubric:${string}` */
  check_key: string | null;
  student_hint_en: string | null;
  student_hint_ar: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** View cc_task_aspects_public: no partial_rule. */
export type CcTaskAspectPublic = Omit<CcTaskAspect, "partial_rule">;

export interface CcAspectResult {
  id: Uuid;
  /** Exactly one of task_result_id / exercise_attempt_id is set. */
  task_result_id: Uuid | null;
  exercise_attempt_id: Uuid | null;
  aspect_id: Uuid;
  user_id: Uuid;
  passed: boolean | null;
  judgement_score: CcJudgementScore | null;
  points_awarded: number;
  feedback_en: string | null;
  feedback_ar: string | null;
  graded_by: Uuid | null;
  graded_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CcSkillScore {
  attempt_id: Uuid;
  skill_area_id: CcSkillAreaId;
  user_id: Uuid;
  earned_points: number | null;
  max_points: number | null;
  percent: number | null;
  level: 1 | 2 | 3 | 4 | 5 | 6 | null;
  assessed: boolean;
  created_at: Timestamp;
}

export interface CcGradingLog {
  id: Uuid;
  kind: CcGradingLogKind;
  submission_id: Uuid | null;
  exercise_attempt_id: Uuid | null;
  task_result_id: Uuid | null;
  model: string | null;
  duration_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  /** USD */
  cost_estimate: number | null;
  error: string | null;
  error_code: string | null;
  response: Json | null;
  created_at: Timestamp;
}

export interface CcIntegrityFlag {
  id: Uuid;
  attempt_id: Uuid;
  task_id: Uuid | null;
  user_id: Uuid | null;
  kind: CcIntegrityKind;
  details: Json;
  resolved_at: Timestamp | null;
  resolved_by: Uuid | null;
  created_at: Timestamp;
}

// ------------------------------------------------------------- help
export interface CcHelpArticle {
  id: Uuid;
  slug: string;
  category: string;
  title_en: string;
  title_ar: string;
  body_en: string;
  body_ar: string;
  related_glossary_terms: string[];
  related_slugs: string[];
  video_id: string | null;
  sort: number;
  is_published: boolean;
  helpful_yes: number;
  helpful_no: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CcHelpSearch {
  id: Uuid;
  query: string;
  locale: CcLocale;
  results_count: number;
  user_id: Uuid | null;
  created_at: Timestamp;
}

// ------------------------------------------------------------- training
export interface CcCourse {
  id: Uuid;
  slug: string;
  title_en: string;
  title_ar: string;
  description_en: string | null;
  description_ar: string | null;
  sort: number;
  is_published: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CcModule {
  id: Uuid;
  course_id: Uuid;
  skill_area_id: CcSkillAreaId | null;
  slug: string;
  title_en: string;
  title_ar: string;
  description_en: string | null;
  description_ar: string | null;
  why_it_matters_en: string | null;
  why_it_matters_ar: string | null;
  icon: string | null;
  is_orientation: boolean;
  sort: number;
  is_published: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CcLevel {
  id: Uuid;
  module_id: Uuid;
  level_number: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  title_en: string;
  title_ar: string;
  goal_en: string | null;
  goal_ar: string | null;
  unlock_rule: Json;
  is_published: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CcLesson {
  id: Uuid;
  level_id: Uuid;
  competition_module: CcCompetitionModuleCode | null;
  slug: string;
  sort: number;
  title_en: string;
  title_ar: string;
  objectives_en: string[];
  objectives_ar: string[];
  duration_minutes: number | null;
  video_inventor_en: string | null;
  video_inventor_ar: string | null;
  video_fusion_en: string | null;
  video_fusion_ar: string | null;
  video_solidworks_en: string | null;
  video_solidworks_ar: string | null;
  video_neutral_en: string | null;
  video_neutral_ar: string | null;
  notes_en: string | null;
  notes_ar: string | null;
  common_mistakes_en: string | null;
  common_mistakes_ar: string | null;
  downloads: Json;
  glossary_terms: string[];
  is_free_preview: boolean;
  is_published: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** Full row: STAFF ONLY (use CcExercisePublic for students). */
export interface CcExercise {
  id: Uuid;
  level_id: Uuid;
  slug: string;
  sort: number;
  skill_area_id: CcSkillAreaId | null;
  competition_module: CcCompetitionModuleCode | null;
  title_en: string;
  title_ar: string;
  brief_en: string | null;
  brief_ar: string | null;
  attachments: Json;
  expected_upload: CcExpectedUpload;
  grading_mode: CcGradingMode;
  grader_mode: CcGraderMode | null;
  reference_data: Json | null;
  rubric: Json | null;
  tolerances: Json | null;
  density_kg_m3: number | null;
  material_name_en: string | null;
  material_name_ar: string | null;
  max_points: number;
  estimated_minutes: number | null;
  pass_mark: number;
  hints_en: string[];
  hints_ar: string[];
  solution_video_id: string | null;
  is_free_sample: boolean;
  test_id: Uuid | null;
  is_published: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** View cc_exercises_public. */
export interface CcExercisePublic
  extends Omit<
    CcExercise,
    "reference_data" | "rubric" | "tolerances" | "grader_mode" | "hints_en" | "hints_ar" | "solution_video_id" | "is_published"
  > {
  hint_count: number;
  has_solution_video: boolean;
}

export interface CcExerciseAttempt {
  id: Uuid;
  user_id: Uuid;
  exercise_id: Uuid;
  storage_path: string | null;
  file_name: string | null;
  file_size: number | null;
  sha256: string | null;
  status: CcResultStatus;
  score: number | null;
  percent: number | null;
  passed: boolean | null;
  error_code: string | null;
  help_slug: string | null;
  feedback_en: string | null;
  feedback_ar: string | null;
  details: Json | null;
  graded_at: Timestamp | null;
  created_at: Timestamp;
}

export interface CcLessonProgress {
  user_id: Uuid;
  lesson_id: Uuid;
  last_second: number;
  watched_percent: number;
  completed_at: Timestamp | null;
  updated_at: Timestamp;
}

export interface CcLessonQuestion {
  id: Uuid;
  user_id: Uuid;
  kind: CcQuestionKind;
  lesson_id: Uuid | null;
  attempt_id: Uuid | null;
  task_result_id: Uuid | null;
  body: string;
  image_path: string | null;
  locale: CcLocale;
  status: CcQuestionStatus;
  answer: string | null;
  answered_by: Uuid | null;
  answered_at: Timestamp | null;
  public: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CcLevelUnlock {
  user_id: Uuid;
  level_id: Uuid;
  unlocked_by: Uuid | null;
  created_at: Timestamp;
}

export interface CcCertificate {
  id: Uuid;
  user_id: Uuid;
  module_id: Uuid;
  code: string;
  pdf_path: string | null;
  issued_at: Timestamp;
}

// ------------------------------------------------------------- payments
export interface CcPlan {
  id: Uuid;
  slug: string;
  name_en: string;
  name_ar: string;
  who_for_en: string | null;
  who_for_ar: string | null;
  includes_en: string[];
  includes_ar: string[];
  price_qar: number;
  duration_days: number;
  includes_in_person: boolean;
  is_featured: boolean;
  is_active: boolean;
  sort: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CcCoupon {
  id: Uuid;
  /** Upper case. */
  code: string;
  discount_type: CcDiscountType;
  discount_value: number;
  expires_at: Timestamp | null;
  max_uses: number | null;
  used_count: number;
  /** null = every plan */
  plan_ids: Uuid[] | null;
  institution: string | null;
  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CcCohort {
  id: Uuid;
  slug: string;
  name_en: string;
  name_ar: string;
  starts_on: DateString | null;
  ends_on: DateString | null;
  schedule_en: string | null;
  schedule_ar: string | null;
  location_en: string | null;
  location_ar: string | null;
  seats_total: number;
  status: CcCohortStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CcPayment {
  id: Uuid;
  user_id: Uuid;
  plan_id: Uuid;
  cohort_id: Uuid | null;
  coupon_id: Uuid | null;
  list_price_qar: number | null;
  discount_qar: number;
  amount_qar: number;
  currency: "QAR";
  method: CcPaymentMethod;
  reference_code: string;
  status: CcPaymentStatus;
  proof_storage_path: string | null;
  payer_name: string | null;
  payer_bank: string | null;
  transfer_reference: string | null;
  transferred_at: Timestamp | null;
  provider_payment_id: string | null;
  reviewed_by: Uuid | null;
  reviewed_at: Timestamp | null;
  reject_reason: string | null;
  reject_reason_ar: string | null;
  receipt_number: number | null;
  raw_payload: Json | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  expires_at: Timestamp | null;
}

export interface CcEnrollment {
  id: Uuid;
  user_id: Uuid;
  plan_id: Uuid | null;
  cohort_id: Uuid | null;
  payment_id: Uuid | null;
  source: CcEnrollmentSource;
  status: CcEnrollmentStatus;
  starts_at: Timestamp;
  ends_at: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
}

// ------------------------------------------------------------- operations
export interface CcAuditLog {
  id: Uuid;
  actor_id: Uuid | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: Json | null;
  after: Json | null;
  created_at: Timestamp;
}

export interface CcDeletionRequest {
  id: Uuid;
  user_id: Uuid;
  reason: string | null;
  status: CcDeletionStatus;
  admin_note: string | null;
  processed_by: Uuid | null;
  created_at: Timestamp;
  processed_at: Timestamp | null;
}

export interface CcStudentNote {
  id: Uuid;
  student_id: Uuid;
  author_id: Uuid | null;
  body: string;
  created_at: Timestamp;
}

// ------------------------------------------------------------- registry
/** Every cc_ table -> its row type. */
export interface CcTables {
  cc_profiles: CcProfile;
  cc_journey_progress: CcJourneyProgress;
  cc_get_ready_steps: CcGetReadyStep;
  cc_skill_areas: CcSkillArea;
  cc_competition_modules: CcCompetitionModule;
  cc_tests: CcTest;
  cc_test_tasks: CcTestTask;
  cc_attempts: CcAttempt;
  cc_submissions: CcSubmission;
  cc_task_results: CcTaskResult;
  cc_task_aspects: CcTaskAspect;
  cc_aspect_results: CcAspectResult;
  cc_skill_scores: CcSkillScore;
  cc_grading_logs: CcGradingLog;
  cc_integrity_flags: CcIntegrityFlag;
  cc_help_articles: CcHelpArticle;
  cc_help_searches: CcHelpSearch;
  cc_courses: CcCourse;
  cc_modules: CcModule;
  cc_levels: CcLevel;
  cc_lessons: CcLesson;
  cc_exercises: CcExercise;
  cc_exercise_attempts: CcExerciseAttempt;
  cc_lesson_progress: CcLessonProgress;
  cc_lesson_questions: CcLessonQuestion;
  cc_level_unlocks: CcLevelUnlock;
  cc_certificates: CcCertificate;
  cc_plans: CcPlan;
  cc_coupons: CcCoupon;
  cc_cohorts: CcCohort;
  cc_payments: CcPayment;
  cc_enrollments: CcEnrollment;
  cc_audit_log: CcAuditLog;
  cc_deletion_requests: CcDeletionRequest;
  cc_student_notes: CcStudentNote;
}

export type CcTableName = keyof CcTables;

export interface CcViews {
  cc_test_tasks_public: CcTestTaskPublic;
  cc_exercises_public: CcExercisePublic;
  cc_task_aspects_public: CcTaskAspectPublic;
}

/** RPC / SQL helper names (0077). */
export const CC_FUNCTIONS = {
  currentRole: "cc_current_role", // () -> CcRole | null ('admin' for site super_admins)
  isStaff: "cc_is_staff", // () -> boolean
  isAdmin: "cc_is_admin", // () -> boolean
  isMinor: "cc_is_minor", // (p_dob date) -> boolean
  hasActiveEnrollment: "cc_has_active_enrollment", // (p_user uuid) -> boolean
  helpFeedback: "cc_help_feedback", // (p_slug text, p_helpful boolean) -> void; service_role only
} as const;

export const CC_BUCKETS = {
  taskFiles: "cc-task-files",
  answerFiles: "cc-answer-files",
  lessonFiles: "cc-lesson-files",
  submissions: "cc-submissions",
  paymentProofs: "cc-payment-proofs",
} as const;

export const CC_BUCKET_LIMITS: Record<(typeof CC_BUCKETS)[keyof typeof CC_BUCKETS], number> = {
  "cc-task-files": 50 * 1024 * 1024,
  "cc-answer-files": 50 * 1024 * 1024,
  "cc-lesson-files": 50 * 1024 * 1024,
  "cc-submissions": 50 * 1024 * 1024,
  "cc-payment-proofs": 10 * 1024 * 1024,
};
