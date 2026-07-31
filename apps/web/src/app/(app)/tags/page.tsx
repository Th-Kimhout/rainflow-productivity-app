"use client";

import { TagView } from "@/components/task/tag-view";

/**
 * Tasks by tag (§3.1's `#tag` capture grammar, made readable).
 *
 * A STATIC ROUTE WITH `?tag=`, not `/tag/[slug]`. The dynamic segment was built first and was
 * wrong twice over:
 *
 *   * It renders on demand rather than prerendering, so every visit costs a server round trip on
 *     a page whose data comes entirely from IndexedDB — straight through the §7.1 FCP budget for
 *     no benefit.
 *   * `generateStaticParams` cannot help, because the tags only exist in the local database. And
 *     an un-prerenderable route cannot be prefetched, so with no service worker (ADR 0001
 *     decision 3) navigating to it OFFLINE fails outright — while every other route in the app
 *     keeps working.
 *
 * One static page, prefetched once from the sidebar, serves every tag.
 */
export default function TagsPage() {
  return <TagView />;
}
