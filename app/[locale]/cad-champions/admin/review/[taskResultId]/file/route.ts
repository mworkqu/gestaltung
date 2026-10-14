import { NextResponse, type NextRequest } from "next/server";

import { getCcUser } from "@/lib/cad-champions/auth/server";
import { loadPackageForResult, packageFileList } from "@/lib/cad-champions/drawing/review-server";
import { readZipEntryData } from "@/lib/cad-champions/grader/zip-extract";
import { normalizeEntryPath } from "@/lib/cad-champions/upload/package-check";
import { readZipEntries } from "@/lib/cad-champions/upload/zip-manifest";
import { openStoredZip } from "@/lib/cad-champions/upload/zip-remote";
import { createServiceClient } from "@/lib/supabase/service";

// One file out of a student's module_package ZIP, for the trainer review
// (native CAD files, renders, the drawing PDF). Staff only. Only files the
// package check listed for this task (or matched to no task) can be read.
// The bytes are streamed back as a download (PDF inline for the viewer) and
// never executed or stored.

export const dynamic = "force-dynamic";

const MAX_BYTES = 100 * 1024 * 1024;

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ locale: string; taskResultId: string }> }) {
  const { taskResultId } = await params;
  const cc = await getCcUser();
  if (!cc?.isStaff) return new NextResponse("Not found", { status: 404 });
  if (!/^[0-9a-f-]{36}$/i.test(taskResultId)) return new NextResponse("Not found", { status: 404 });
  const path = req.nextUrl.searchParams.get("path") ?? "";
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  const service = createServiceClient();
  if (!service) return new NextResponse("Unavailable", { status: 503 });

  try {
    const pkg = await loadPackageForResult(service, taskResultId);
    if (!pkg) return new NextResponse("Not found", { status: 404 });
    const allowed = packageFileList(pkg.manifest, pkg.taskId);
    if (!allowed.task.includes(path) && !allowed.unmatched.includes(path)) return new NextResponse("Not found", { status: 404 });

    const zip = await openStoredZip("cc-submissions", pkg.storagePath, 900);
    if (!zip.ok) return new NextResponse("Not found", { status: 404 });
    const listing = await readZipEntries(zip.size, zip.read, { maxEntries: 500 });
    if (!listing.ok) return new NextResponse("Unreadable package", { status: 422 });
    const entry = listing.entries.find((e) => {
      const safe = normalizeEntryPath(e.name);
      return safe.ok && safe.path === path && !e.isDirectory;
    });
    if (!entry) return new NextResponse("Not found", { status: 404 });
    if (entry.uncompressedSize > MAX_BYTES) return new NextResponse("File too large to extract here; download the whole ZIP instead.", { status: 413 });
    const data = await readZipEntryData(entry, zip.read, MAX_BYTES);
    if (!data.ok) return new NextResponse("Could not read this file; download the whole ZIP instead.", { status: 422 });

    const name = path.split("/").pop() || "file";
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
    const type = TYPES[ext] ?? "application/octet-stream";
    const disposition = inline && ext === ".pdf" ? "inline" : "attachment";
    const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    return new NextResponse(Buffer.from(data.bytes), {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Content-Length": String(data.bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("[cc-review] package file failed:", e instanceof Error ? e.message : "unknown");
    return new NextResponse("Error", { status: 500 });
  }
}
