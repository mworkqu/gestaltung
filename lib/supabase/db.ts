// Short names for the generated schema types (lib/supabase/database.types.ts),
// so call sites can type a row or a write payload without spelling out
// Database["public"]["Tables"][...]. Type-only: nothing here runs.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

export type { Database, Json, JsonInput } from "./database.types";

type PublicSchema = Database["public"];

export type TableName = keyof PublicSchema["Tables"];
export type ViewName = keyof PublicSchema["Views"];
export type FunctionName = keyof PublicSchema["Functions"];

/** A row as read back from a table. */
export type TableRow<T extends TableName> = PublicSchema["Tables"][T]["Row"];
/** The payload `.insert()` accepts for a table. */
export type TableInsert<T extends TableName> = PublicSchema["Tables"][T]["Insert"];
/** The payload `.update()` accepts for a table (every column optional). */
export type TableUpdate<T extends TableName> = PublicSchema["Tables"][T]["Update"];
/** A row as read back from a view. */
export type ViewRow<V extends ViewName> = PublicSchema["Views"][V]["Row"];
/** What an rpc returns. */
export type FunctionReturns<F extends FunctionName> = PublicSchema["Functions"][F]["Returns"];

/** Any of the four typed clients (browser, cookie server, service, public). */
export type DbClient = SupabaseClient<Database>;
