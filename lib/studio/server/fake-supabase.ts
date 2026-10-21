// Test helper: a tiny in-memory Supabase for the Studio product routes
// (lib/studio/server/product-routes.test.ts, doc.test.ts). Emulates just what
// those routes use: auth.getUser, from(table) select / eq / in / not / like / order /
// limit / maybeSingle / update(...).select / insert / upsert, json-path select
// aliases (`product:studio->product`), RLS on projects (owner or super_admin),
// storage signed URLs and rpc() with scripted answers. Never used by app code.

type Row = Record<string, unknown>;
type RpcAnswer = { data?: unknown; error?: { code?: string; message: string } | null };

export type FakeUser = { id: string; is_anonymous?: boolean } | null;

export type FakeDb = {
  tables: Record<string, Row[]>;
  user: FakeUser;
  rpc: Record<string, (args: Record<string, unknown>) => RpcAnswer>;
  rpcCalls: { fn: string; args: Record<string, unknown> }[];
  uploads: { bucket: string; path: string; bytes: number }[];
};

const isAdmin = (db: FakeDb) => {
  const me = db.user && db.tables.profiles?.find((p) => p.id === db.user!.id);
  return me?.role === "super_admin";
};

function visible(db: FakeDb, table: string, row: Row): boolean {
  if (table !== "projects") return true;
  return !!db.user && (row.user_id === db.user.id || isAdmin(db));
}

function pickCols(row: Row, cols: string): Row {
  if (cols.trim() === "*" || !cols.trim()) return { ...row };
  const out: Row = {};
  for (const raw of cols.split(",").map((c) => c.trim()).filter(Boolean)) {
    const [alias, expr] = raw.includes(":") ? raw.split(":") : [null, raw];
    const [col, ...path] = expr.split("->");
    let v: unknown = row[col];
    for (const k of path) v = v && typeof v === "object" ? (v as Row)[k] : undefined;
    out[alias ?? (path.length ? path[path.length - 1] : col)] = v === undefined ? null : structuredClone(v);
  }
  return out;
}

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: ((r: Row) => boolean)[] = [];
  private cols = "*";
  private op: "select" | "update" | "insert" | "upsert" = "select";
  private payload: Row | Row[] | null = null;
  private returnRows = false;
  private single = false;
  private max = Infinity;

  constructor(private db: FakeDb, private table: string) {}

  select(cols = "*") {
    this.cols = cols;
    if (this.op !== "select") this.returnRows = true;
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  /** Only the "is null" form the reuse lookup uses (`.not(col, "is", null)`). */
  not(col: string, op: string, v: unknown) {
    if (op === "is" && v === null) this.filters.push((r) => r[col] !== null && r[col] !== undefined);
    else this.filters.push((r) => r[col] !== v);
    return this;
  }
  like(col: string, pattern: string) {
    const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`);
    this.filters.push((r) => re.test(String(r[col] ?? "")));
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  update(p: Row) {
    this.op = "update";
    this.payload = p;
    return this;
  }
  insert(p: Row | Row[]) {
    this.op = "insert";
    this.payload = p;
    return this;
  }
  upsert(p: Row | Row[]) {
    this.op = "upsert";
    this.payload = p;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  private run(): { data: unknown; error: unknown } {
    const rows = (this.db.tables[this.table] ??= []);
    if (this.op === "insert" || this.op === "upsert") {
      for (const p of Array.isArray(this.payload) ? this.payload : [this.payload!]) {
        if (this.op === "upsert" && this.table === "ai_rate_limits") {
          const hit = rows.find((r) => r.key === p.key && r.day === p.day);
          if (hit) {
            Object.assign(hit, p);
            continue;
          }
        }
        rows.push(structuredClone(p));
      }
      return { data: null, error: null };
    }
    const hits = rows.filter((r) => visible(this.db, this.table, r) && this.filters.every((f) => f(r)));
    if (this.op === "update") {
      for (const r of hits) Object.assign(r, structuredClone(this.payload));
      return { data: this.returnRows ? hits.map((r) => pickCols(r, this.cols)) : null, error: null };
    }
    const out = hits.slice(0, this.max).map((r) => pickCols(r, this.cols));
    return { data: this.single ? (out[0] ?? null) : out, error: null };
  }

  then<A, B>(ok?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.run()).then(ok, bad);
  }
}

export function fakeSupabase(init: Partial<FakeDb> & { tables?: Record<string, Row[]> }) {
  const db: FakeDb = {
    tables: init.tables ?? {},
    user: init.user ?? null,
    rpc: init.rpc ?? {},
    rpcCalls: [],
    uploads: [],
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: db.user }, error: null }) },
    from: (table: string) => new Query(db, table),
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      db.rpcCalls.push({ fn, args });
      const h = db.rpc[fn];
      if (!h) return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}` } };
      const r = h(args);
      return { data: r.data ?? null, error: r.error ?? null };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: Uint8Array) => {
          db.uploads.push({ bucket, path, bytes: body.length });
          return { data: { path }, error: null };
        },
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed.test/${bucket}/${path}` }, error: null }),
        createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed.test/${bucket}/${p}`, error: null })), error: null }),
      }),
    },
  };
  return { db, client };
}
