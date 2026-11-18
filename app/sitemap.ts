import type { MetadataRoute } from "next";

import { listCaseStudies } from "@/lib/case-studies";
import { getSitemapProducts } from "@/lib/store/public-catalog";
import { sitemapEntries } from "@/lib/seo";

// Rebuilt at most daily (consolidation 2.3; was hourly). The product list is a
// cached read tagged "parts" + "parts-listing", so publishing, unpublishing or
// re-listing a product (any write that purges the listing) refreshes the
// sitemap at once; a product's <lastmod> (parts.updated_at) can otherwise lag
// by up to a day, which crawlers tolerate.
export const revalidate = 86400;

// Static pages plus every product the storefront page serves: published and
// not merged into another product, each with its updated_at as lastmod. If
// Supabase is unreachable the static pages still go out.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await getSitemapProducts();
  // Case studies are listed only once at least one story is published.
  const caseStudySlugs = listCaseStudies({ publishedOnly: true }).map((c) => c.slug);
  return sitemapEntries(products, undefined, caseStudySlugs);
}
