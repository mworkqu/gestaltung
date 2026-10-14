// Supabase resumable (TUS) upload for files over 6 MB. Browser only (the
// tus-js-client import is dynamic, so it never lands in the first-load
// bundle). A dropped connection resumes from the last 6 MB chunk: tus keeps
// a fingerprint of the upload in localStorage and findPreviousUploads()
// picks it up on retry.

import { TUS_CHUNK_BYTES } from "./validate";

export interface TusUploadInput {
  file: File;
  bucket: string;
  objectName: string;
  contentType: string;
  /** The signed-in user's access token (RLS applies to the upload). */
  accessToken: string;
  supabaseUrl: string;
  anonKey: string;
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
}

export interface TusOptionsShape {
  endpoint: string;
  retryDelays: number[];
  headers: Record<string, string>;
  uploadDataDuringCreation: boolean;
  removeFingerprintOnSuccess: boolean;
  chunkSize: number;
  metadata: Record<string, string>;
}

/** The tus options for Supabase Storage (pure; tested). */
export function buildTusOptions(input: Omit<TusUploadInput, "file" | "onProgress">): TusOptionsShape {
  const base = input.supabaseUrl.replace(/\/+$/, "");
  return {
    endpoint: `${base}/storage/v1/upload/resumable`,
    retryDelays: [0, 3000, 5000, 10000, 20000],
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      apikey: input.anonKey,
      "x-upsert": "false",
    },
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    chunkSize: TUS_CHUNK_BYTES,
    metadata: {
      bucketName: input.bucket,
      objectName: input.objectName,
      contentType: input.contentType,
      cacheControl: "3600",
    },
  };
}

export interface TusHandle {
  /** Resolves when the upload finished; rejects on a final error. */
  done: Promise<void>;
  /** Stops the upload (keeps the fingerprint so it can resume). */
  abort: () => void;
}

/** Starts (or resumes) a resumable upload. */
export async function startTusUpload(input: TusUploadInput): Promise<TusHandle> {
  const { Upload } = await import("tus-js-client");
  const options = buildTusOptions(input);
  let upload: InstanceType<typeof Upload> | null = null;

  const done = new Promise<void>((resolve, reject) => {
    upload = new Upload(input.file, {
      ...options,
      onProgress: (sent, total) => input.onProgress?.(sent, total),
      onSuccess: () => resolve(),
      onError: (err) => reject(err),
    });
    const u = upload;
    u.findPreviousUploads()
      .then((previous) => {
        if (previous.length > 0) u.resumeFromPreviousUpload(previous[0]);
        u.start();
      })
      .catch(() => u.start());
  });

  return {
    done,
    abort: () => {
      void (upload as InstanceType<typeof Upload> | null)?.abort(false);
    },
  };
}
