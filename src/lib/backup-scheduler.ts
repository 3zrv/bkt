import { prisma } from "@/lib/db"
import { getBackupConfig } from "@/lib/backup"
import { resolveTaskSchedule, nextRunAtForTaskSchedule } from "@/lib/task-schedule"

const DEDUPE_KEY = "database_backup"

export async function ensureBackupTaskScheduled(): Promise<void> {
  const config = getBackupConfig()
  if (!config) return

  const existing = await prisma.task.findFirst({
    where: { type: DEDUPE_KEY, status: { not: "failed" } },
    select: { id: true, scheduleCron: true },
  })

  const resolved = resolveTaskSchedule({
    isRecurring: true,
    scheduleCron: config.scheduleCron,
  })
  const nextRunAt = nextRunAtForTaskSchedule(resolved, new Date()) ?? new Date()

  if (existing) {
    if (existing.scheduleCron !== config.scheduleCron) {
      await prisma.task.update({
        where: { id: existing.id },
        data: { scheduleCron: config.scheduleCron, nextRunAt },
      })
    }
    return
  }

  await prisma.task.create({
    data: {
      type: "database_backup",
      title: "Scheduled database backup",
      status: "pending",
      payload: {},
      isRecurring: true,
      scheduleCron: config.scheduleCron,
      nextRunAt,
    },
  })
}
