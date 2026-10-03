import { legalMetadata, legalPage } from "@/components/legal/legal-document";

// Static: the text is read from content/legal/warranty.<locale>.md at build time.
export const generateMetadata = legalMetadata("warranty");

export default legalPage("warranty");
