"use client";

import { type ParsedCapture, dayKeyOf, minutesIntoDay, todayKey } from "@rainflow/data";
import { AlertTriangle, CalendarClock, Hash, Star } from "lucide-react";

/**
 * Live feedback for §3.1 parsing.
 *
 * This exists because natural-language parsing is guesswork made visible or it is a trap.
 * Without it, "review PR monday" silently becomes a task due on some particular date and the
 * user has no idea which — and the failure only surfaces days later when it does not appear in
 * Today. Showing the resolved date as it is typed makes a misparse obvious immediately.
 */
export function ParsedChips({ parsed }: { parsed: ParsedCapture }) {
  const hasAnything =
    parsed.dueAt !== null ||
    parsed.tags.length > 0 ||
    parsed.isUrgent ||
    parsed.isImportant;

  if (!hasAnything) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-2">
      {parsed.dueAt ? <DueChip iso={parsed.dueAt} allDay={parsed.dueIsAllDay} /> : null}

      {parsed.tags.map((tag) => (
        <Chip key={tag} icon={<Hash className="size-3" />} tone="secondary">
          {tag}
        </Chip>
      ))}

      {parsed.isUrgent ? (
        <Chip icon={<AlertTriangle className="size-3" />} tone="high">
          urgent
        </Chip>
      ) : null}

      {parsed.isImportant ? (
        <Chip icon={<Star className="size-3" />} tone="rain">
          important
        </Chip>
      ) : null}
    </div>
  );
}

const TONES = {
  rain: "bg-rain/15 text-rain",
  secondary: "bg-rain-secondary/15 text-rain-secondary",
  high: "bg-priority-high/15 text-priority-high",
  muted: "bg-accent text-muted-foreground",
} as const;

function Chip({
  icon,
  tone,
  children,
}: {
  icon: React.ReactNode;
  tone: keyof typeof TONES;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}

const WEEKDAY_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "Asia/Phnom_Penh",
});

/**
 * The resolved due date, in words.
 *
 * Formatted in APP_TIMEZONE explicitly. Using the browser's default would show a different day
 * to someone travelling — and the whole point of this chip is to state exactly what got stored.
 */
function DueChip({ iso, allDay }: { iso: string; allDay: boolean }) {
  const date = new Date(iso);
  const key = dayKeyOf(date);
  const today = todayKey();

  let label: string;
  if (key === today) label = "today";
  else if (key === addDaysKey(today, 1)) label = "tomorrow";
  else label = WEEKDAY_FMT.format(date);

  if (!allDay) {
    const mins = minutesIntoDay(date);
    const hh = String(Math.floor(mins / 60)).padStart(2, "0");
    const mm = String(mins % 60).padStart(2, "0");
    label += ` ${hh}:${mm}`;
  }

  return (
    <Chip icon={<CalendarClock className="size-3" />} tone="rain">
      {label}
    </Chip>
  );
}

/** Local one-off rather than importing addDays, to keep this component's surface small. */
function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(
    shifted.getUTCDate(),
  ).padStart(2, "0")}`;
}
