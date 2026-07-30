import { APP_TIMEZONE, todayKey, weekdayOf } from "@rainflow/data";

/*
 * Phase 0 placeholder. This exists so the `/` -> `/today` redirect resolves and so the
 * §4.1 palette is verifiable in a browser. Phase 1 replaces it with the real AppShell
 * plus a Dexie-backed list; at that point `todayKey()` moves to a client-side ticker,
 * because a value computed during a static prerender is frozen at build time.
 */
export default function TodayPage() {
  const day = todayKey();
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
    weekdayOf(day)
  ];

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Today</p>
        <h1 className="mt-1 font-sans text-2xl font-semibold text-foreground">
          {weekday}, {day}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{APP_TIMEZONE}</p>

        <div className="mt-6 flex flex-wrap gap-2">
          <span className="rounded-md bg-rain px-2 py-1 text-xs font-medium text-background">
            Rain Blue
          </span>
          <span className="rounded-md bg-rain-secondary px-2 py-1 text-xs font-medium text-background">
            Secondary
          </span>
          <span className="rounded-md bg-success px-2 py-1 text-xs font-medium text-background">
            Success
          </span>
          <span className="rounded-md bg-priority-high px-2 py-1 text-xs font-medium text-background">
            High
          </span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">Phase 0 — foundation only.</p>
    </main>
  );
}
