"use client";

import { LogOut, MoreHorizontal, Plus, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { NAV, PHONE_BAR } from "@/components/shell/nav-items";
import { openCapture } from "@/lib/capture";
import { PRIORITY, useKeyHandler } from "@/lib/keyboard/provider";
import { getSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Navigation and capture on a phone, where the app's entire interaction model is missing.
 *
 * §4.2 makes RainFlow keyboard-first — ⌘K to capture, `G`-chords to navigate, J/K to move — and
 * a touchscreen has none of that. Every one of those bindings has a mouse equivalent somewhere
 * except capture, which had no button anywhere in the app: on a phone the app was read-only.
 * That is what the ＋ in the middle of this bar is for, and why it sits in the middle, which is
 * the one part of a bottom bar a thumb reaches without regripping.
 *
 * A bottom bar rather than a hamburger drawer for the same reason. The top-left corner of a
 * large phone is the furthest point from a thumb, and this is the control used most.
 *
 * IN FLOW, NOT FIXED. The shell is a fixed-height column (`h-dvh` on the body), so a bar that
 * participates in that column cannot overlap content, and no view has to leave a gap for it. It
 * does have to pad for the home indicator itself — `viewportFit: "cover"` in the layout means
 * the page paints under it.
 */
export function MobileNav() {
  const pathname = usePathname();
  const [more, setMore] = useState(false);

  // Widened because `PHONE_BAR` is a tuple of the four slots it holds, and `item.href` ranges
  // over all eight — `includes` would otherwise reject the four it is meant to return false for.
  const inBar = (href: string) => (PHONE_BAR as readonly (string | null)[]).includes(href);
  const rest = NAV.filter((item) => !inBar(item.href));
  const onRest = rest.some((item) => item.href === pathname);

  return (
    <>
      {more && <MoreSheet items={rest} pathname={pathname} onClose={() => setMore(false)} />}

      <nav
        aria-label="Main"
        className="relative flex shrink-0 items-stretch border-t border-border bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {PHONE_BAR.map((href) =>
          href === null ? (
            <CaptureButton key="capture" />
          ) : (
            <Tab key={href} href={href} active={pathname === href} />
          ),
        )}

        <TabButton
          label="More"
          icon={MoreHorizontal}
          // Lit while you are *on* one of the destinations it hides, or the bar would claim
          // nothing is selected on five of the eight screens.
          active={onRest}
          onClick={() => setMore(true)}
          aria-expanded={more}
        />
      </nav>
    </>
  );
}

/**
 * Capture, raised out of the bar.
 *
 * It breaks the row's rhythm on purpose: it is the only control here that acts rather than
 * navigates, and on a phone it is the only route to creating a task at all. The lift is
 * `-translate-y` inside a `relative` bar rather than a `fixed` overlay, so it stays anchored to
 * the bar as the safe-area padding changes underneath it.
 */
function CaptureButton() {
  return (
    <div className="flex flex-1 items-start justify-center">
      <button
        type="button"
        onClick={openCapture}
        aria-label="Capture a task"
        className={cn(
          "-translate-y-3 flex size-14 items-center justify-center rounded-full",
          "bg-rain text-background ring-4 ring-sidebar",
          // Two shadows doing different jobs: a tight one to seat it above the bar, and a wide
          // tinted one that reads as the button glowing rather than casting.
          "shadow-[0_4px_14px_rgba(56,189,248,0.45),0_0_28px_rgba(56,189,248,0.35)]",
          "transition-transform duration-150 active:scale-90",
        )}
      >
        <Plus className="size-7" strokeWidth={2.5} />
      </button>
    </div>
  );
}

function Tab({ href, active }: { href: string; active: boolean }) {
  // `PHONE_BAR` holds hrefs, not entries, so the label, icon and chord stay defined once in NAV.
  // A slot naming a route that no longer exists renders nothing rather than crashing the shell.
  const item = NAV.find((entry) => entry.href === href);
  if (!item) return null;

  return (
    <Link
      href={item.href}
      prefetch
      aria-current={active ? "page" : undefined}
      className={cn(TAB_CLASS, active ? "text-rain" : "text-muted-foreground")}
    >
      <Glow active={active} />
      <item.icon className="relative size-5" aria-hidden />
      <span className="relative">{item.label}</span>
    </Link>
  );
}

function TabButton({
  label,
  icon: Icon,
  active,
  onClick,
  ...rest
}: {
  label: string;
  icon: (typeof NAV)[number]["icon"];
  active: boolean;
  onClick: () => void;
} & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(TAB_CLASS, active ? "text-rain" : "text-muted-foreground")}
      {...rest}
    >
      <Glow active={active} />
      <Icon className="relative size-5" aria-hidden />
      <span className="relative">{label}</span>
    </button>
  );
}

const TAB_CLASS =
  "relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] transition-colors";

/**
 * What marks the current tab.
 *
 * Colour alone was the whole signal, and rain blue against slate at 10px is a difference you have
 * to look for. This adds two things you do not: a lit cap along the top edge where the eye
 * already is after a navigation, and a soft bloom behind the icon.
 *
 * `aria-hidden`, and never the only signal — `aria-current="page"` is what actually says which
 * tab is active, and the colour change carries it for anyone who cannot see the glow.
 */
function Glow({ active }: { active: boolean }) {
  if (!active) return null;

  return (
    <>
      <span
        aria-hidden
        className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-rain shadow-[0_0_10px_2px_rgba(56,189,248,0.7)]"
      />
      <span
        aria-hidden
        className="absolute left-1/2 top-1.5 size-9 -translate-x-1/2 rounded-full bg-rain/20 blur-md"
      />
    </>
  );
}

/** The five destinations that do not fit the bar, plus sign out. */
function MoreSheet({
  items,
  pathname,
  onClose,
}: {
  items: readonly (typeof NAV)[number][];
  pathname: string;
  onClose: () => void;
}) {
  useKeyHandler(
    PRIORITY.overlay,
    (event) => {
      if (event.key !== "Escape") return false;
      event.preventDefault();
      onClose();
      return true;
    },
    { whenTyping: true },
  );

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-background/70 backdrop-blur-sm md:hidden"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="rounded-t-2xl border-t border-border bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="More"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">RainFlow</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <ul className="grid grid-cols-3 gap-2">
          {items.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                prefetch
                onClick={onClose}
                aria-current={pathname === href ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg px-2 py-3 text-xs transition-colors",
                  pathname === href
                    ? "bg-rain-soft text-rain"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </Link>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => void getSupabase().auth.signOut()}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm text-muted-foreground ring-1 ring-border transition-colors hover:text-foreground"
        >
          <LogOut className="size-4" aria-hidden />
          Sign out
        </button>
      </div>
    </div>
  );
}
