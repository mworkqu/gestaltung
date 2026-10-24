// Shared types for the YouTube upload + retire modules (lib/youtube-upload.ts,
// lib/youtube-retire.ts). A leaf: each of those re-exports what it used to define.

export type QuotaState = { day: string; used: number };

export const PRIVACY = ["private", "unlisted", "public"] as const;
export type Privacy = (typeof PRIVACY)[number];

export type UploadRecord = {
  video_id: string;
  uploaded_at: string;
  privacy: Privacy;
  /** Steps after the upload that did not work: "captions_en" | "captions_ar" | "thumbnail" | "site". */
  warnings: string[];
};

export type YoutubeMeta = {
  channel_id: string;
  channel_title: string;
  quota: QuotaState | null;
  uploads: Record<string, UploadRecord>;
  /** Retire log: outdated videos to delete (lib/youtube-retire.ts). */
  retire: RetireEntry[];
};

export const RETIRE_STATUS = ["queued", "deleted", "failed", "cancelled"] as const;
export type RetireStatus = (typeof RETIRE_STATUS)[number];
export const RETIRE_REASON = ["replaced", "manual"] as const;
export type RetireReason = (typeof RETIRE_REASON)[number];

export type RetireEntry = {
  video_id: string;
  title?: string;
  reason: RetireReason;
  queued_at: string;
  delete_after: string;
  status: RetireStatus;
  deleted_at?: string;
  error?: string;
  replaced_by?: string;
};
