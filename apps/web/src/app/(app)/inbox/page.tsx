"use client";

import { TaskList } from "@/components/task/task-list";
import { useInboxTasks } from "@/lib/data/hooks";

/**
 * §3.1's landing place. Everything captured with Cmd+K arrives here, because capture must never
 * block on deciding where something belongs — that is the "smart fallbacks" requirement.
 *
 * §5.1 step 1 is then processing this list each morning.
 */
export default function InboxPage() {
  const tasks = useInboxTasks();

  return (
    <div>
      <header className="border-b border-border px-6 py-4">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Unprocessed</p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-foreground">
          Inbox
          {tasks && tasks.length > 0 ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {tasks.length}
            </span>
          ) : null}
        </h1>
      </header>

      <TaskList tasks={tasks} emptyMessage="Inbox is empty." />
    </div>
  );
}
