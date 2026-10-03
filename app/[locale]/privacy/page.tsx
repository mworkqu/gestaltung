import { legalMetadata, legalPage } from "@/components/legal/legal-document";

// Static: the text is read from content/legal/privacy.<locale>.md at build time.
export const generateMetadata = legalMetadata("privacy");

export default legalPage("privacy");
