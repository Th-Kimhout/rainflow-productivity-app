"use client";

import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { getSupabase } from "@/lib/supabase/client";

export type SessionState =
  | { status: "loading"; session: null }
  | { status: "signed-in"; session: Session }
  | { status: "signed-out"; session: null };

/**
 * The current Supabase session.
 *
 * `loading` is a distinct state rather than being folded into `signed-out`, because reading the
 * session from storage is async: treating "not yet known" as "signed out" would flash the login
 * page on every reload for an already-authenticated user.
 */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: "loading", session: null });

  useEffect(() => {
    const supabase = getSupabase();
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setState(
        data.session
          ? { status: "signed-in", session: data.session }
          : { status: "signed-out", session: null },
      );
    });

    /*
     * Fires on sign-in, sign-out, and TOKEN_REFRESHED. The refresh case matters for a tab left
     * open all day: supabase-js hands the rotated token to the Realtime socket internally, but
     * this keeps React's copy of the session in step too.
     */
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setState(
        session
          ? { status: "signed-in", session }
          : { status: "signed-out", session: null },
      );
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
