// Search caps for /store (consolidation 2.3). Kept in a dependency-free module
// so client search boxes can import the number without pulling in
// lib/store/catalog.ts. Every distinct /store?q=... or ?page=N is a dynamic
// render, so bots walking long queries or deep pages were pure cost: the search
// boxes stop at MAX_STORE_QUERY characters and the pager at MAX_STORE_PAGE;
// a URL past either is answered 404 (storeParamsOutOfRange in catalog.ts).
// 20 pages x 48 = 960 products, about today's whole listed catalogue
// unfiltered; a category, filter or search narrows anything beyond.

export const MAX_STORE_QUERY = 64;
export const MAX_STORE_PAGE = 20;

/** A /store?q= value built from stored text (an occasion, a video): at most MAX_STORE_QUERY characters. */
export const storeQueryText = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, MAX_STORE_QUERY).trim();
