import { metaFor } from "@/lib/meta";

// The page is a client component, so its title lives here (audit #56).
export const generateMetadata = metaFor("cart");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
