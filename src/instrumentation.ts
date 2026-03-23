export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return

  const { prisma } = await import("./lib/db")
  const { setupServerErrorLogging } = await import("./lib/system-logger")
  const { startTaskRunner } = await import("./lib/task-runner")

  setupServerErrorLogging()

  // Ensure the local user exists (all FK references point to this row).
  // Retry a few times — the DB may not be accepting connections yet on cold start.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await prisma.user.upsert({
        where: { id: "local" },
        update: {},
        create: { id: "local", name: "Local User", email: "local@localhost", role: "admin" },
      })
      break
    } catch (err) {
      if (attempt < 4) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 1000))
      } else {
        console.error("[instrumentation] Failed to ensure local user after retries:", err)
      }
    }
  }

  // Schedule backup task if configured
  try {
    const { ensureBackupTaskScheduled } = await import("./lib/backup-scheduler")
    await ensureBackupTaskScheduled()
  } catch (err) {
    console.error("[backup-scheduler] failed to schedule backup task:", err)
  }

  startTaskRunner()
}
