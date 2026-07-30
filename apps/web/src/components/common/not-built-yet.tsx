import { Kbd } from "@/components/common/kbd";

/**
 * Placeholder for a destination that exists in the nav and has a `G`-chord bound, but whose
 * feature has not been built yet.
 *
 * These exist rather than being omitted from the sidebar for two reasons: `typedRoutes` makes a
 * link to a nonexistent route a build error, and prefetching all destinations is what keeps
 * offline navigation working without a service worker.
 */
export function NotBuiltYet({
  title,
  phase,
  section,
  description,
}: {
  title: string;
  phase: string;
  section: string;
  description: string;
}) {
  return (
    <div>
      <header className="border-b border-border px-6 py-4">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">{section}</p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-foreground">{title}</h1>
      </header>

      <div className="px-6 py-10">
        <p className="text-sm text-foreground">{description}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          Arriving in {phase}. Capture still works from here — <Kbd>⌘K</Kbd> or <Kbd>C</Kbd>.
        </p>
      </div>
    </div>
  );
}
