import { legalMetadata, legalPage } from "@/components/legal/legal-document";

// Static: the text is read from content/legal/delivery-returns.<locale>.md at build time.
export const generateMetadata = legalMetadata("delivery-returns");

export default legalPage("delivery-returns");
