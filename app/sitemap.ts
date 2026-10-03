import type { MetadataRoute } from "next";

import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { createPublicClient } from "@/lib/supabase/public";
import { sitemapEntries, type SitemapProduct } from "@/lib/seo";

// Rebuilt at most hourly: new products appear within the hour without a deploy.
export const revalidate = 3600;

// Static pages plus every product the storefront page serves: published and
// not merged into another product. The anonymous, cookie-free client is
// enough (published parts are anon-readable) and the fetch pages past
// PostgREST's 1,000-row cap. If Supabase is unreachable the static pages
// still go out.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = createPublicClient();
  let products: SitemapProduct[] = [];
  if (supabase) {
    const { rows } = await fetchAllRows<SitemapProduct>((from, to) =>
      supabase
        .from("parts")
        .select("sku, updated_at")
        .eq("is_published", true)
        .is("merged_into", null)
        .order("id")
        .range(from, to)
    );
    products = rows;
  }
  return sitemapEntries(products);
}
