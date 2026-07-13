// A tiny in-memory hand-off for the public quote flow. The homepage dropzone
// stashes the picked CAD file here, then client-navigates to /design/quote,
// which reads it back. A File can't be serialized to sessionStorage, so we keep
// it in a module-level variable — this survives Next.js client-side navigation
// (the app stays mounted) but NOT a hard refresh, in which case the quote page
// falls back to its own file picker.

let pendingFile: File | null = null;

export function setPendingUpload(file: File | null): void {
  pendingFile = file;
}

export function takePendingUpload(): File | null {
  const f = pendingFile;
  pendingFile = null; // consume once so a back-nav doesn't re-attach stale files
  return f;
}
