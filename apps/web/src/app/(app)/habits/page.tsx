"use client";

import { HabitList } from "@/components/habits/habit-list";

/**
 * §3.4 habit tracking and routine building.
 *
 * The list carries its own header so the archived toggle and the new-habit button sit in the same
 * bar as the title — one row rather than two, on a screen where the heatmaps want the height.
 */
export default function HabitsPage() {
  return <HabitList />;
}
