// Empty shim for Next.js's `server-only` package so unit tests can import
// server-only modules without tripping the build-time guard. The real
// `server-only` throws when included in a client bundle; in tests the
// guard is meaningless and an empty module is the canonical workaround
// (see https://nextjs.org/docs/app/building-your-application/rendering/composition-patterns#keeping-server-only-code-out-of-the-client-environment).
export {};
