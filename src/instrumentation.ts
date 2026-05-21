// Next.js startup hook (runs once per server process).
// We use this to start the in-process Reddit poller without needing Redis/BullMQ.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackgroundPoller } = await import("./lib/background-poller");
    startBackgroundPoller();
  }
}
