/**
 * Next.js instrumentation hook — runs once on server startup (Node.js runtime).
 * Used to start the auto-send scheduler without blocking the request path.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/auto-send/scheduler");
    startScheduler();
    const { startTieredRewardsScheduler } = await import("./lib/tiered-rewards/scheduler");
    startTieredRewardsScheduler();
    const { startTracerWatcher } = await import("./lib/tracer-v2/watcher");
    startTracerWatcher();
  }
}
