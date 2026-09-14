import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest must resolve the `@/*` → `src/*` path alias that `tsconfig.json`
 * declares for Next.
 *
 * Every route handler under `src/app/api/**` imports its seams through that
 * alias (`@/lib/supabase-admin`, `@/lib/owner-auth`, …). Next resolves it from
 * tsconfig `paths`; Vite does not, and Vite's own resolver returns `null` for
 * such a specifier, so without this alias no route module can be imported by a
 * test at all. (The pre-existing `src/lib/*.test.ts` suites are unaffected —
 * they only ever import their subject relatively — which is why the test suite
 * ran without a config before route-level tests existed.)
 *
 * The alias is a string, not a regex: `@rollup/plugin-alias` matches a string
 * pattern only for the exact value or a `pattern + "/"` prefix, so package
 * names such as `@supabase/supabase-js` are never rewritten.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
