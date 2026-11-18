import { NextResponse, type NextRequest } from "next/server";

import { adminGuard } from "@/lib/cad-champions/admin/server";
import { filterStudents, parseStudentFilters, studentsCsv } from "@/lib/cad-champions/admin/students";
import { loadStudentRows } from "@/lib/cad-champions/admin/students-server";

// CSV export of the Students table with the same filters as the page.
// Admin only (re-checked here, never trusted from the page). Contact columns
// (email, phone) are filled only for students with marketing consent
// (studentsCsv). Never cached.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await adminGuard("admin");
  if (!g.ok) return new NextResponse(g.error === "forbidden" ? "Not found" : "Unavailable", { status: g.error === "forbidden" ? 404 : 503 });
  const params: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    if (!(k in params)) params[k] = v;
  });
  const filters = parseStudentFilters(params);
  const loaded = await loadStudentRows(g.db);
  if (!loaded.ok) return new NextResponse(loaded.reason === "not_set_up" ? "Not set up yet" : "Error", { status: loaded.reason === "not_set_up" ? 409 : 500 });
  const rows = filterStudents(loaded.rows, filters, Date.now());
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(studentsCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cad-champions-students-${day}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
