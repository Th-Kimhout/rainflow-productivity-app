"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { DataProvider } from "@/lib/data/provider";
import { useSession } from "@/lib/supabase/use-session";

/**
 * Client-side auth gate.
 *
 * There is intentionally NO `proxy.ts` (the Next 16 rename of `middleware.ts`) doing this
 * server-side. RLS is the real boundary — the shell contains no secrets, and every route is a
 * static skeleton. A proxy would run Node on every request and make each route dynamic,
 * spending the §7.1 FCP budget to protect a page that has nothing on it.
 *
 * So this redirect is a UX affordance, not a security control. Someone who bypassed it would
 * see an empty app: without a session, no request they make satisfies `is_app_owner()`.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { status, session } = useSession();

  useEffect(() => {
    if (status === "signed-out") router.replace("/login");
  }, [status, router]);

  if (status === "loading") {
    /*
     * Reading the session from storage is async. Rendering the app here would mount the sync
     * engine without credentials; redirecting here would flash /login on every reload for an
     * already-authenticated user. So: hold, briefly.
     */
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (status === "signed-out") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Redirecting to sign in…</p>
      </div>
    );
  }

  return <DataProvider session={session}>{children}</DataProvider>;
}
