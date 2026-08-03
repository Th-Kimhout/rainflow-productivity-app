"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Kbd } from "@/components/common/kbd";
import { NAV } from "@/components/shell/nav-items";
import { getSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Left navigation (§4.1).
 *
 * Every link is prefetched, and that is load-bearing rather than an optimisation. Without a
 * service worker (ADR 0001 decision 3), navigating to a route whose payload has not been
 * fetched fails offline. Prefetching all destinations on first render means the whole app is
 * warm before it is needed, which shrinks "offline" from "only this page works" to "everything
 * you'd navigate to works".
 *
 * Hidden below `md`, where `<MobileNav>` takes over: 224px of permanent navigation out of a
 * 390px screen is more than half the width spent on chrome.
 */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="hidden w-56 shrink-0 flex-col border-r border-border bg-sidebar md:flex"
    >
      <div className="flex h-12 items-center gap-2 px-4">
        <span className="size-2 rounded-full bg-rain" aria-hidden />
        <span className="text-sm font-semibold tracking-tight">RainFlow</span>
      </div>

      <ul className="flex-1 space-y-0.5 px-2 py-2">
        {NAV.map(({ href, label, icon: Icon, chord }) => {
          const active = pathname === href;
          return (
            <li key={href}>
              <Link
                href={href}
                prefetch
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-rain-soft font-medium text-rain"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="flex-1">{label}</span>
                <Kbd className="opacity-0 transition-opacity group-hover:opacity-100">
                  {chord}
                </Kbd>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={() => void getSupabase().auth.signOut()}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <LogOut className="size-4 shrink-0" aria-hidden />
          Sign out
        </button>
      </div>
    </nav>
  );
}
