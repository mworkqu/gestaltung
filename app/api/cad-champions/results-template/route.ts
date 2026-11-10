import { getCcUser } from "@/lib/cad-champions/auth/server";
import { TEMPLATE_ZIP_NAME, templateEntries } from "@/lib/cad-champions/upload/package-check";
import { zipStore } from "@/lib/studio/zip";

// The empty competition Results folder layout as a ZIP
// (CAD-Champions-Results-Template.zip), built at request time with the
// site's store-only zip writer. Signed-in CC users only.

export const dynamic = "force-dynamic";

export async function GET() {
  const cc = await getCcUser();
  if (!cc) return Response.json({ error: "signed_out" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const zip = zipStore(templateEntries().map((name) => ({ name, data: "" })));
  const body = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${TEMPLATE_ZIP_NAME}"`,
      "Content-Length": String(zip.byteLength),
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
