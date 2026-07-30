/**
 * The Eisenhower matrix (PRD §3.2), derived rather than stored.
 *
 * §6 kept `priority` (LOW..URGENT) and `quadrant` (DO_FIRST..ELIMINATE) as independent
 * columns, which meant §3.1's `@high` parsing wrote one while §3.2's drag-and-drop wrote the
 * other, and they could silently disagree. ADR 0001 decision 9 made `is_urgent` +
 * `is_important` the only stored facts; everything here is a pure function of those two.
 *
 * Consequence worth remembering: there is nothing to keep in sync, and no migration needed if
 * the presentation of a quadrant ever changes.
 */

export type Quadrant = "DO_FIRST" | "SCHEDULE" | "DELEGATE" | "ELIMINATE";

export interface EisenhowerFlags {
  is_urgent: boolean;
  is_important: boolean;
}

/** The §3.2 quadrant for a task. Total — every combination maps somewhere. */
export function quadrantOf(task: EisenhowerFlags): Quadrant {
  if (task.is_important) return task.is_urgent ? "DO_FIRST" : "SCHEDULE";
  return task.is_urgent ? "DELEGATE" : "ELIMINATE";
}

/** The flags a quadrant implies. Inverse of `quadrantOf`; used when dragging between cells. */
export function setQuadrant(quadrant: Quadrant): EisenhowerFlags {
  switch (quadrant) {
    case "DO_FIRST":
      return { is_urgent: true, is_important: true };
    case "SCHEDULE":
      return { is_urgent: false, is_important: true };
    case "DELEGATE":
      return { is_urgent: true, is_important: false };
    case "ELIMINATE":
      return { is_urgent: false, is_important: false };
  }
}

/**
 * A sortable urgency score for list views, standing in for §6's deleted `priority` column.
 *
 * Higher sorts first. Important-but-not-urgent deliberately outranks urgent-but-not-important:
 * that is the entire argument of the Eisenhower method, and a list ordered the other way would
 * quietly undermine §3.2's purpose.
 */
export function displayPriority(task: EisenhowerFlags): number {
  if (task.is_important && task.is_urgent) return 3;
  if (task.is_important) return 2;
  if (task.is_urgent) return 1;
  return 0;
}

export const QUADRANT_LABELS: Record<Quadrant, string> = {
  DO_FIRST: "Do First",
  SCHEDULE: "Schedule",
  DELEGATE: "Delegate",
  ELIMINATE: "Eliminate",
};
