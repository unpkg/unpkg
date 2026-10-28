import { handleRequest } from "./lib/request-handler.ts";

// One-line memory telemetry every minute, alongside the cache and
// limiter stats lines, so heap growth can be attributed from logs:
// heapUsed climbing = retained JS objects; RSS climbing alone =
// allocator/native retention.
//
// UNPKG_RSS_WATCHDOG_BYTES > 0 enables a graceful self-restart: when
// RSS crosses the threshold, stop accepting new connections, give
// in-flight work a short drain window, then exit non-zero so Fly's
// on-failure restart policy brings the machine back with a fresh
// heap and a warm (volume-backed) cache. This converts an eventual
// kernel OOM - which truncates in-flight responses - into a planned
// restart that truncates none.
let watchdogBytes = Number(process.env.UNPKG_RSS_WATCHDOG_BYTES ?? 0);
let watchdogDraining = false;
let memoryTimer = setInterval(() => {
  let m = process.memoryUsage();
  console.log(
    `[memory] rss=${m.rss} heapUsed=${m.heapUsed} heapTotal=${m.heapTotal} external=${m.external} arrayBuffers=${m.arrayBuffers}`
  );
  if (watchdogBytes > 0 && !watchdogDraining && m.rss > watchdogBytes) {
    watchdogDraining = true;
    console.log(`[watchdog] rss=${m.rss} over threshold=${watchdogBytes}; draining and exiting for restart`);
    try {
      server.stop();
    } catch {}
    // Deliberately NOT unref'd: this timer is what guarantees the
    // non-zero exit (Fly restarts on-failure only). An unref'd timer
    // lets the process exit 0 once the server stops, and the machine
    // would stay down.
    setTimeout(() => process.exit(1), 10_000);
  }
}, 60_000);
(memoryTimer as unknown as { unref?: () => void }).unref?.();

let server = Bun.serve({
  fetch: handleRequest,
  idleTimeout: 255,
});

console.log(`Server listening on http://${server.hostname}:${server.port} ...`);
console.log();
