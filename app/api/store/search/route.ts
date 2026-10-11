import { getStoreListing } from "@/lib/store/public-catalog";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { handleStoreSearch, SUGGEST_RATE, suggestState } from "@/lib/store/search-suggest";

// GET /api/store/search?q=&locale= — instant store search for the home and
// store search boxes (W7). Top 6 products, public card fields only
// (lib/store/search-suggest.ts toSuggestion), EN + AR names. Data from the
// cached cookie-free catalogue read (unstable_cache, tag "parts"); responses
// are CDN-cached for 60 s per query; per-IP rate limit per instance.

const rate = createRateLimiter(SUGGEST_RATE);

export async function GET(request: Request) {
  return handleStoreSearch(
    request,
    { listing: (q, locale) => getStoreListing(suggestState(q), locale), rate },
    clientIp(request.headers),
  );
}
