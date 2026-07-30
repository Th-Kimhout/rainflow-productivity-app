"use client";

import type { Database } from "@rainflow/data/types";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

/**
 * The browser Supabase client. There is deliberately no server client.
 *
 * Every route in this app is statically prerendered with no server data (ADR 0001 decision 6),
 * and all data access happens browser → PostgREST directly under RLS (decision 4). A server
 * client would exist only to serve data we do not fetch on the server, and adding one would
 * make routes dynamic and forfeit the static-shell FCP budget in §7.1.
 *
 * Singleton because `createBrowserClient` sets up auth storage listeners and a Realtime
 * socket; constructing it per render would leak both.
 */
let client: SupabaseClient<Database> | null = null;

export function getSupabase(): SupabaseClient<Database> {
  if (client) return client;

  client = createBrowserClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      // Keeps the session in localStorage and refreshes it in the background, so a
      // long-lived tab stays authenticated — which matters for an app meant to sit open all
      // day. Refresh-token rotation is enabled server-side.
      persistSession: true,
      autoRefreshToken: true,
      /*
       * PKCE is still the right flow for password auth — it costs nothing here and keeps the
       * door open for OAuth later. The cross-device problem that ruled out magic links does
       * not apply, because nothing arrives by email.
       */
      flowType: "pkce",
    },
  });

  return client;
}
