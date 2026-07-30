import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * @rainflow/data is a source-only internal package — its `exports` point at raw .ts,
   * so Next has to compile it rather than treat it as a prebuilt dependency.
   */
  transpilePackages: ["@rainflow/data"],

  // Typed `router.push` targets, which the G-chord navigation (§4.2) leans on.
  typedRoutes: true,

  reactStrictMode: true,

  async redirects() {
    return [{ source: "/", destination: "/today", permanent: false }];
  },

  /*
   * Deliberately absent:
   *
   * - `webpack`: Turbopack is the default builder in Next 16 and ANY webpack key makes
   *   `next build` fail outright. This also rules out @next/bundle-analyzer and Serwist
   *   (which is part of why ADR 0001 skips the service worker).
   *
   * - `cacheComponents`: buys nothing here — no route has server data to cache — and it
   *   would keep routes mounted in <Activity mode="hidden">, which pauses effects. A
   *   paused setInterval would silently break the §3.3 pomodoro.
   *
   * - `turbopack.root`: auto-detected from pnpm-lock.yaml at the monorepo root. Only set
   *   this if `next dev` starts warning about workspace root inference.
   */
};

export default nextConfig;
