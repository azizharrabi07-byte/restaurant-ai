import { hasBackend } from "@/lib/supabase-admin";

/**
 * Keep in sync with the "version" field in package.json.
 * A literal (instead of importing JSON) avoids `resolveJsonModule` /
 * bundler config churn for a value that changes once per release.
 */
const VERSION = "0.1.0";

/**
 * Liveness probe for the container healthcheck (see Dockerfile HEALTHCHECK
 * and docker-compose.yml).
 *
 * Contract: this endpoint MUST NOT require any environment variable and MUST
 * NOT touch the database. A container started with no `.env.local` is still
 * "alive" — it just reports that its backend is unconfigured.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      ok: true,
      backend: hasBackend(),
      ocr: Boolean(process.env.MISTRAL_API_KEY),
      version: VERSION,
    },
    { status: 200 },
  );
}
