"use client";

// Google Drive Picker (Task 17a): browse Drive and pick images without leaving
// the admin. Google Identity Services gives a short-lived access token with
// the drive.file scope — it only reaches files the owner picks — and the
// Picker returns their ids. The server then copies those files into Supabase
// Storage with the same token (/api/admin/drive-import).
//
// Needs NEXT_PUBLIC_GOOGLE_CLIENT_ID, NEXT_PUBLIC_GOOGLE_API_KEY and
// NEXT_PUBLIC_GOOGLE_APP_ID (the Cloud project number).

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
const APP_ID = process.env.NEXT_PUBLIC_GOOGLE_APP_ID;
const SCOPE = "https://www.googleapis.com/auth/drive.file";

export type PickedFile = { id: string; name: string; mimeType: string };

export const drivePickerConfigured = Boolean(CLIENT_ID && API_KEY && APP_ID);

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`load ${src}`));
    document.head.appendChild(s);
  });
}

let ready: Promise<void> | null = null;
function loadApis() {
  ready ??= (async () => {
    await Promise.all([loadScript("https://apis.google.com/js/api.js"), loadScript("https://accounts.google.com/gsi/client")]);
    await new Promise<void>((resolve) => window.gapi.load("picker", () => resolve()));
  })();
  return ready;
}

let token: { value: string; expires: number } | null = null;

function getToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return Promise.resolve(token.value);
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (res: { access_token?: string; expires_in?: number; error?: string }) => {
        if (!res.access_token) return reject(new Error(res.error ?? "no token"));
        token = { value: res.access_token, expires: Date.now() + (res.expires_in ?? 3600) * 1000 };
        resolve(res.access_token);
      },
      error_callback: (e: { type?: string }) => reject(new Error(e?.type ?? "oauth")),
    });
    client.requestAccessToken({ prompt: token ? "" : "consent" });
  });
}

/** Opens the Picker. Resolves null when cancelled. */
export async function pickDriveImages(multiple: boolean): Promise<{ files: PickedFile[]; token: string } | null> {
  if (!drivePickerConfigured) throw new Error("not_configured");
  await loadApis();
  const accessToken = await getToken();
  const g = window.google;
  return new Promise((resolve) => {
    const view = new g.picker.DocsView(g.picker.ViewId.DOCS_IMAGES).setIncludeFolders(true).setSelectFolderEnabled(false);
    let builder = new g.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(API_KEY)
      .setAppId(APP_ID)
      .setOrigin(window.location.protocol + "//" + window.location.host)
      .setCallback((data: any) => {
        if (data.action === g.picker.Action.PICKED) {
          resolve({
            token: accessToken,
            files: (data.docs ?? []).map((d: any) => ({ id: d.id, name: d.name, mimeType: d.mimeType })),
          });
        } else if (data.action === g.picker.Action.CANCEL) resolve(null);
      });
    if (multiple) builder = builder.enableFeature(g.picker.Feature.MULTISELECT_ENABLED);
    builder.build().setVisible(true);
  });
}

export type ProductImage = { web: string; thumb: string; path: string; drive_file_id: string | null };
export type ImportedImage = ProductImage & { name: string };

/** Copies picked files into Supabase Storage, a few per request. */
export async function importDriveFiles(
  files: PickedFile[],
  accessToken: string,
  onProgress?: (done: number) => void
): Promise<{ images: ImportedImage[]; failed: string[] }> {
  const images: ImportedImage[] = [];
  const failed: string[] = [];
  for (let i = 0; i < files.length; i += 4) {
    const chunk = files.slice(i, i + 4);
    const res = await fetch("/api/admin/drive-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: accessToken, files: chunk.map((f) => ({ id: f.id, name: f.name })) }),
    }).catch(() => null);
    const data = res?.ok ? ((await res.json()) as { results: (ImportedImage & { error?: string })[] }) : null;
    if (!data) failed.push(...chunk.map((f) => f.name));
    else
      for (const r of data.results) {
        if (r.error) failed.push(r.name);
        else images.push(r);
      }
    onProgress?.(Math.min(files.length, i + chunk.length));
  }
  return { images, failed };
}

/** "led_red-5mm (2).jpg" → "Led red 5mm (2)". */
export function nameFromFilename(filename: string): string {
  const base = filename.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_]+/g, " ").replace(/\s*-\s*/g, " ").replace(/\s+/g, " ").trim();
  return base ? base[0].toUpperCase() + base.slice(1) : filename;
}
