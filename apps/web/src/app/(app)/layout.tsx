import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { AuthGate } from "@/components/shell/auth-gate";

/**
 * Authenticated layout.
 *
 * A Server Component that renders client children — it fetches nothing, so every route beneath
 * it still prerenders to static HTML and ships from the CDN in one round trip, which is the
 * §7.1 FCP budget.
 *
 * AuthGate wraps AppShell rather than the reverse: the sync engine lives in the DataProvider
 * inside AuthGate, so it only ever boots with a session in hand, and the shell below it can
 * assume a write context exists.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <AppShell>{children}</AppShell>
    </AuthGate>
  );
}
