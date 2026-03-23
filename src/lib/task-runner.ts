import { processOneTask } from "./task-processor"

const POLL_INTERVAL_MS = 5_000

let running = false

export function startTaskRunner() {
  const timer = setInterval(async () => {
    if (running) return
    running = true
    try {
      // Process tasks in a burst until none are due
      let processed = true
      while (processed) {
        const result = await processOneTask()
        processed = result.processed
      }
    } catch (err) {
      console.error("[task-runner] error:", err)
    } finally {
      running = false
    }
  }, POLL_INTERVAL_MS)

  if (typeof timer === "object" && "unref" in timer) {
    timer.unref()
  }
}
