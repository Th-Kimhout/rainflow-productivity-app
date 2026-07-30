/**
 * Environment access, validated once at module load.
 *
 * `process.env.NEXT_PUBLIC_*` is inlined at build time, so a missing value does not throw — it
 * becomes `undefined` and surfaces much later as an opaque "Invalid API key" from PostgREST.
 * Failing loudly here turns that into an immediate, readable error.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy apps/web/.env.example to .env.local and fill it in — ` +
        `see supabase/README.md.`,
    );
  }
  return value;
}

export const env = {
  supabaseUrl: required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
  /**
   * Publishable key. Public by design — it ships in the client bundle and identifies the
   * project, nothing more. RLS is the actual access boundary, which is why a public repo is
   * safe here (ADR 0001 decision 10).
   */
  supabasePublishableKey: required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ),
} as const;
