// Request bodies for /api/project-cad and /api/bom/match (AI-10, AI-11). Pure.
// The cuts are the ones the routes made by hand before; hard caps above them
// only bound what is parsed at all, so honest requests never fail.

import { z } from "zod";

import { createRateLimiter } from "@/lib/rate-limit";
import { asLocale } from "@/lib/locale";

/** 8-4-4-4-12 hex, the shape the other AI routes accept for a project id. */
const UUID_LIKE = /^[0-9a-f-]{36}$/i;

export const PROJECT_CAD_LIMITS = { storagePath: 400, fileName: 200 } as const;

export const ProjectCadBody = z
  .object({
    project_id: z.string().max(100).nullish(),
    storage_path: z.string().max(2000).nullish(),
    file_name: z.string().max(2000).nullish(),
    file_size: z.union([z.number(), z.string().max(32)]).nullish(),
    locale: z.string().max(16).nullish(),
  })
  .transform((b) => {
    const size = Number(b.file_size);
    return {
      projectId: (b.project_id ?? "").trim(),
      storagePath: (b.storage_path ?? "").trim().slice(0, PROJECT_CAD_LIMITS.storagePath),
      fileName: (b.file_name ?? "").trim().slice(0, PROJECT_CAD_LIMITS.fileName),
      fileSize: Number.isFinite(size) && size > 0 ? size : 0,
      locale: asLocale(b.locale),
    };
  });

export const BomMatchBody = z.object({ projectId: z.string().regex(UUID_LIKE) });

/**
 * /api/project-cad emails the owner on every call: 5 notifications per user per
 * 10 minutes, per server instance (AI-11).
 */
export const projectCadRate = createRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000 });
