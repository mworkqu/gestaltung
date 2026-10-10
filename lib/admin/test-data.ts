// Test data that must never count on the owner's home screen or stock lists.
// Three rules, any one is enough:
//   1. the row says so (is_test = true, migration 0031),
//   2. the name / message / SKU looks like a test ("TEST" as a capitalised word,
//      "please ignore", "please delete", "delete me", a name or SKU such as TEST-SERVO),
//   3. its id is on the cleanup list in docs/TEST_DATA_CLEANUP.md (first 8
//      characters of each id are enough; a few rows there only list a prefix).
// Pure, no I/O. Keep TEST_ID_PREFIXES in sync with docs/TEST_DATA_CLEANUP.md.

export const TEST_ID_PREFIXES: readonly string[] = [
  // projects
  "78d00e58",
  "dd3f63ea",
  "5a3ae942",
  "fdd2a6c7",
  "c3881430",
  "055c5073",
  "fbefc059",
  "47d7814d",
  // part_orders
  "945ea389",
  "159b5246",
  "3cbf6a8c",
  "75c58b7b",
  "1b0dca20",
  "f28dcf37",
  // inquiries
  "2f1e6ed7",
  "e4a966e9",
  "5f90cd3f",
];

const TEST_WORD = /\bTEST\b/; // capitalised on purpose: "Test probe" is a real product
const TEST_PHRASE = /please ignore|please delete|delete me/i;

export function isTestId(id: string | null | undefined): boolean {
  if (!id) return false;
  const head = id.slice(0, 8).toLowerCase();
  return TEST_ID_PREFIXES.includes(head);
}

export type MaybeTest = {
  id?: string | null;
  is_test?: boolean | null;
  /** Any free text that could carry a TEST marker: name, customer name, message, sku. */
  texts?: (string | null | undefined)[];
};

export function isTestRow(row: MaybeTest): boolean {
  if (row.is_test === true) return true;
  if (isTestId(row.id)) return true;
  for (const text of row.texts ?? []) {
    if (!text) continue;
    if (TEST_WORD.test(text) || TEST_PHRASE.test(text)) return true;
  }
  return false;
}
