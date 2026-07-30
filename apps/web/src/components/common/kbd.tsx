import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A keycap. §4.2 wants the app fully operable by keyboard, so shortcuts stay visible. */
export function Kbd({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
