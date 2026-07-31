"use client";

import { CalendarView } from "@/components/views/calendar-view";

/**
 * §5.1 step 2, second half: timeboxing.
 *
 * No page header. The view carries its own date navigation, and a second heading above it would
 * cost 60px of vertical room on the one screen in the app where vertical room is the content.
 */
export default function CalendarPage() {
  return <CalendarView />;
}
