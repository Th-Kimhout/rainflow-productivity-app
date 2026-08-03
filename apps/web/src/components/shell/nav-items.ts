import {
  BarChart3,
  CalendarCheck,
  CalendarRange,
  Grid2x2,
  Inbox,
  Repeat,
  Settings,
  Tags,
} from "lucide-react";

/**
 * The eight destinations, in one place.
 *
 * Shared by the desktop sidebar and the phone's bottom bar rather than duplicated into each,
 * because the two are already guaranteed to diverge: they show different subsets, and a route
 * added to one and forgotten in the other is unreachable on that device with no error to say so.
 *
 * `as const` is load-bearing — `typedRoutes` needs the literal string, not `string`.
 */
export const NAV = [
  { href: "/today", label: "Today", icon: CalendarCheck, chord: "G T" },
  { href: "/inbox", label: "Inbox", icon: Inbox, chord: "G I" },
  { href: "/matrix", label: "Matrix", icon: Grid2x2, chord: "G E" },
  { href: "/calendar", label: "Calendar", icon: CalendarRange, chord: "G C" },
  { href: "/habits", label: "Habits", icon: Repeat, chord: "G H" },
  { href: "/tags", label: "Tags", icon: Tags, chord: "G G" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, chord: "G A" },
  { href: "/settings", label: "Settings", icon: Settings, chord: "G S" },
] as const;

export type NavItem = (typeof NAV)[number];

/**
 * The bottom bar, in the order it is laid out. `null` is where capture sits.
 *
 * A bar holds about five targets before they stop being thumb-sized, and two of the five are
 * spoken for: capture, and the way to reach the other five destinations. These three are what
 * §5.1's daily loop actually opens — check today, process the inbox, plan the day. Everything
 * else is a weekly-review or setup screen and lives behind "More".
 *
 * CAPTURE IS THE MIDDLE SLOT, not an item appended to the row. Dead centre is the one point a
 * thumb reaches from either hand without regripping, and this is the most-used control in the
 * app — on a phone it is the *only* way to create a task, since ⌘K and `C` need a keyboard.
 */
export const PHONE_BAR = ["/today", "/inbox", null, "/calendar"] as const;
