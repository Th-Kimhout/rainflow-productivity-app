import path from "node:path";

import { defineConfig } from "vitest/config";

/*
 * No @vitejs/plugin-react here on purpose. Its v6 line depends on Vite 8 (rolldown) while
 * Vitest 3 runs on Vite 7, and the two Plugin types do not unify — `tsc --noEmit` fails even
 * though the tests execute fine. The plugin exists for Fast Refresh, which tests do not use;
 * esbuild's automatic JSX transform is all React Testing Library needs.
 */
export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // Source-only workspace package; Vitest needs the same treatment Next gives it through
      // `transpilePackages`.
      "@rainflow/data": path.resolve(import.meta.dirname, "../../packages/data/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
