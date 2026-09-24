// "Is this product already in the catalogue?" (Task 17e). Two names are
// similar when their normalised forms match, their word sets match, or they
// carry the same numbers and their character-bigram (Dice) similarity is
// ≥ 0.85. Used to warn, never to block.

export function normalizeName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s+/g, "");
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.split(" ").sort().join(" ") === nb.split(" ").sort().join(" ")) return 1;
  // Different numbers are different parts: "10k resistor" ≠ "1k resistor", "M3 x 10" ≠ "M3 x 12".
  const nums = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).sort().join(",");
  if (nums(na) !== nums(nb)) return 0;
  const A = bigrams(na);
  const B = bigrams(nb);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of A) {
    overlap += Math.min(n, B.get(g) ?? 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  return total ? (2 * overlap) / total : 0;
}

export const SIMILAR_THRESHOLD = 0.85;

export function findSimilar<T extends { name: string }>(name: string, pool: T[]): T[] {
  return pool.filter((p) => nameSimilarity(name, p.name) >= SIMILAR_THRESHOLD).slice(0, 3);
}
