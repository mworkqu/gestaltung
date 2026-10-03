import { legalMetadata, legalPage } from "@/components/legal/legal-document";

// Static: the text is read from content/legal/terms.<locale>.md at build time.
export const generateMetadata = legalMetadata("terms");

export default legalPage("terms");
