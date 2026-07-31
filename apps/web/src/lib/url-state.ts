"use client";

import { type DayKey, isDayKey, todayKey } from "@rainflow/data";
import { useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * Transient UI state kept in the URL: which task the inspector shows, which view mode is active,
 * whether zen mode is on.
 *
 * These live in `searchParams` rather than React state so they are linkable, survive back/forward,
 * and can be restored on reload — opening a task is a place you can return to.
 *
 * WHY `window.history.pushState` AND NOT `router.push`: `router.push` performs a Next navigation,
 * which re-runs the route and refetches its RSC payload. Since every view here renders from Dexie
 * that would be pure overhead on every inspector open. Next 16 documents shallow `pushState` as
 * integrating with `useSearchParams`, so mutating the URL directly still updates the hook.
 *
 * CALLERS MUST SIT INSIDE A <Suspense> BOUNDARY. `useSearchParams` in a statically prerendered
 * route requires one, or `next build` fails outright — see `AppShell`.
 */

export type ViewMode = "list" | "board" | "calendar";

export function useUrlState() {
  const params = useSearchParams();

  const set = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null) next.delete(key);
      else next.set(key, value);

      const query = next.toString();
      window.history.pushState(
        null,
        "",
        query ? `${window.location.pathname}?${query}` : window.location.pathname,
      );
    },
    [params],
  );

  const taskId = params.get("task");
  const zenTaskId = params.get("zen");
  const rawView = params.get("view");
  const view: ViewMode =
    rawView === "board" || rawView === "calendar" ? rawView : "list";

  /*
   * The calendar's date. Validated rather than trusted: `?day=lol` reaching `parseDayKey` would
   * throw during render and blank the route, and a URL is user-editable by definition.
   *
   * `todayKey()` resolves through APP_TIMEZONE, so the default is today in Phnom Penh regardless
   * of where the browser thinks it is.
   */
  const rawDay = params.get("day");
  const day: DayKey = isDayKey(rawDay) ? rawDay : todayKey();

  return {
    taskId,
    zenTaskId,
    view,
    day,
    openTask: useCallback((id: string) => set("task", id), [set]),
    closeTask: useCallback(() => set("task", null), [set]),
    setDay: useCallback(
      // Today is the default, so it is dropped rather than written — and a bookmarked
      // `/calendar` then always means "today" rather than the day it was bookmarked on.
      (next: DayKey) => set("day", next === todayKey() ? null : next),
      [set],
    ),
    setView: useCallback(
      // `list` is the default, so it is dropped rather than written — keeps URLs clean.
      (mode: ViewMode) => set("view", mode === "list" ? null : mode),
      [set],
    ),
  };
}
