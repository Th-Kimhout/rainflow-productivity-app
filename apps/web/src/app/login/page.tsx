"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/supabase/use-session";

/**
 * Email + password sign-in (ADR 0001 decision 11).
 *
 * Not a magic link: the free tier forbids editing email templates, so the default mail carries
 * no {{ .Token }} and there is no code to fall back to when PKCE strands its verifier on the
 * wrong device. Password auth also removes email delivery from the critical path of being able
 * to log in at all, which suits an app whose premise is working when the network is unreliable.
 *
 * There is no sign-up path here, deliberately. Signups are disabled server-side and the account
 * is created from the dashboard — offering a form that always fails would be worse than not
 * offering one.
 */
export default function LoginPage() {
  const router = useRouter();
  const { status } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in (or just signed in) — leave.
  useEffect(() => {
    if (status === "signed-in") router.replace("/today");
  }, [status, router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const { error: signInError } = await getSupabase().auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      /*
       * Supabase returns "Invalid login credentials" for both a wrong password and an unknown
       * address, which is correct — distinguishing them would let anyone enumerate whether an
       * address has an account. Passed through rather than "improved".
       */
      setError(signInError.message);
      setBusy(false);
      return;
    }

    // onAuthStateChange drives the redirect via the effect above.
    router.replace("/today");
  }

  return (
    // `overflow-y-auto` because the body no longer scrolls — on a short phone in landscape the
    // form is taller than the viewport, and without this the sign-in button is unreachable.
    <main className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">RainFlow</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to continue.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              // Focused on mount: §1.2 zero-friction, and this is the only field on the page.
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-md border border-priority-high/40 bg-priority-high/10 px-3 py-2 text-sm text-priority-high"
            >
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={busy || !email || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="mt-6 text-xs text-muted-foreground">
          Single-user app — accounts are created from the Supabase dashboard, not here.
        </p>
      </div>
    </main>
  );
}
