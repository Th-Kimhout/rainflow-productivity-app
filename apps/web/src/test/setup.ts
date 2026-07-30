import "fake-indexeddb/auto";
import "@testing-library/react";

/*
 * `env.ts` throws at module load if these are missing, which is deliberate — but tests should
 * not depend on a developer's .env.local existing.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";
