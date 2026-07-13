// Storage bucket for public "request a quote" file uploads (see migration
// 0012_quote_uploads.sql). Private bucket; the browser uploads directly with the
// anon key, the server mints signed download URLs with the service-role key.
export const QUOTE_BUCKET = "quote-uploads";
