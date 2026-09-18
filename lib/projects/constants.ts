// Materials a client can pick for a project. Stored as the plain key in
// project_materials.material; the label is translated per locale via the
// Projects.material_<key> message keys.
export const PROJECT_MATERIALS = [
  "pla",
  "petg",
  "abs",
  "resin",
  "aluminium_6061",
  "stainless_304",
  "mild_steel",
  "brass",
  "acrylic",
  "plywood",
  "mdf",
  "carbon_fibre",
] as const;

export type ProjectMaterialKey = (typeof PROJECT_MATERIALS)[number];

// Project block images live in this private bucket under <user_id>/<project_id>/.
export const PROJECT_IMAGE_BUCKET = "project-images";

export const MAX_PROJECT_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB, matches the bucket
export const PROJECT_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
