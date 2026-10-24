// Migration 0104 (audit DB-15 / WEB-06): the quote-uploads INSERT policy only
// accepts <uuid>/<sanitized file name> — the uploader's shape, the same one
// lib/design/quote-paths.ts signs. PGlite on a storage.objects stub with the
// 0012 policies; the policy is applied TWICE. Never touches Supabase.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SUPABASE_BASE_STUB, migration, pgliteDb } from "@/lib/db-test/pglite";
import { isAllowedQuoteStoragePath } from "@/lib/design/quote-paths";

const STUB = `
${SUPABASE_BASE_STUB}
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, owner uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
`;

const UUID = "3f2b8c1e-9a4d-4b7e-8f21-0c5d6e7f8a9b";
const GOOD = [`${UUID}/bracket_v2.step`, `${UUID}/Part-1.STL`, `${UUID.toUpperCase()}/a.pdf`, `${UUID}/${"a".repeat(200)}`];
const BAD = [
  "a/b/c.html",
  `${UUID}/sub/file.stl`,
  `${UUID}/../x.stl`,
  `${UUID}/x..stl`,
  `${UUID}/.`,
  `${UUID}/file name.stl`,
  `${UUID}/${"a".repeat(201)}`,
  `not-a-uuid/file.stl`,
  `${UUID}`,
  `/${UUID}/file.stl`,
];

const { db, as, fails } = pgliteDb();
const upload = (name: string, bucket = "quote-uploads") =>
  as(null, () => fails("insert into storage.objects (bucket_id, name) values ($1, $2)", [bucket, name]));

describe("0104_quote_upload_path", () => {
  beforeAll(async () => {
    await db.exec(STUB);
    await db.exec(migration("0012_quote_uploads.sql"));
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it("BEFORE: anon writes any name into quote-uploads (0012)", async () => {
    for (const name of BAD) expect(await upload(name)).toBeNull();
  });

  it("AFTER (applied twice): only <uuid>/<sanitized name>, no '..'", async () => {
    for (let i = 0; i < 2; i++) await db.exec(migration("0104_quote_upload_path.sql"));
    for (const name of GOOD) expect(await upload(name), name).toBeNull();
    for (const name of BAD) expect(await upload(name), name).toMatch(/row-level security/);
    const [b] = (await db.query<{ file_size_limit: string }>("select file_size_limit from storage.buckets where id = 'quote-uploads'")).rows;
    expect(Number(b.file_size_limit)).toBe(52428800);
  });

  it("agrees with lib/design/quote-paths.ts (what the route signs) on every case except '..' inside a name", () => {
    for (const name of GOOD) expect(isAllowedQuoteStoragePath("quote-uploads", name, null), name).toBe(true);
    for (const name of BAD.filter((n) => !n.endsWith("x..stl"))) expect(isAllowedQuoteStoragePath("quote-uploads", name, null), name).toBe(false);
  });

  it("the uploader's own path passes", async () => {
    const sanitize = (n: string) => n.replace(/[^a-zA-Z0-9._-]/g, "_"); // components/design/quote-request.tsx
    expect(await upload(`${crypto.randomUUID()}/${sanitize("my bracket (v2).step")}`)).toBeNull();
  });
});
