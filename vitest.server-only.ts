// Stand-in for the `server-only` package under vitest. The real package throws
// when imported outside a Next server build, which would stop tests from
// importing the server modules that carry the marker. Aliased in vitest.config.ts.
export {};
