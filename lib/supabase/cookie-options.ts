import type { CookieOptionsWithName } from "@supabase/ssr";

// Cookie attributes for the Supabase auth cookies (audit WEB-04). Every
// Supabase client (browser, server, middleware) must pass the SAME options,
// otherwise the chunked sb-*-auth-token cookies get diverging attributes.
//
// Only `secure` is set: in production the cookies never travel over plain
// HTTP. path "/", sameSite "lax" and the 400-day maxAge stay the library
// defaults. httpOnly cannot be turned on: the browser client reads the session
// from document.cookie.
//
// The default reads process.env.NODE_ENV literally so Next inlines it into the
// browser bundle too (a bare process.env object is empty in the browser).
export function supabaseCookieOptions(nodeEnv: string | undefined = process.env.NODE_ENV): CookieOptionsWithName {
  return { secure: nodeEnv === "production" };
}
