import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  resolveTaskSchedule,
  getUpcomingRunDatesFromCron,
} from "@/lib/task-schedule"

type TaskStatus = "pending" | "running" | "paused" | "completed" | "failed"

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const scope = request.nextUrl.searchParams.get("scope") ?? "ongoing"
    const typeParam = request.nextUrl.searchParams.get("type")
    const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "50")
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 50

    const statuses: TaskStatus[] =
      scope === "history"
        ? ["completed", "failed"]
        : scope === "all"
          ? ["pending", "running", "paused", "completed", "failed"]
          : ["pending", "running", "paused", "failed"]

    const ALLOWED_TYPES = new Set(["bulk_delete", "object_transfer", "database_backup"])
    const typeFilter = typeParam
      ? typeParam.split(",").filter((t) => ALLOWED_TYPES.has(t))
      : undefined

    const [tasks, cachedFiles] = await Promise.all([
      prisma.task.findMany({
        where: {
          status: { in: statuses },
          ...(typeFilter && typeFilter.length > 0 ? { type: { in: typeFilter } } : undefined),
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
      }),
      prisma.fileMetadata.count({
        where: { userId: "local", isFolder: false },
      }),
    ])

    const now = new Date()
    const mappedTasks = tasks.map((task) => {
      const schedule = resolveTaskSchedule(task)
      const scheduleEnabled = task.status !== "paused" && schedule.enabled

      return {
        id: task.id,
        type: task.type,
        title: task.title,
        status: task.status,
        progress: task.progress,
        error: task.error,
        isRecurring: task.isRecurring && schedule.enabled,
        scheduleCron: schedule.cron,
        nextRunAt: task.nextRunAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        upcomingRuns: scheduleEnabled && schedule.cron
          ? getUpcomingRunDatesFromCron(schedule.cron, task.nextRunAt > now ? task.nextRunAt : now, 3)
          : [],
      }
    })

    return NextResponse.json({
      tasks: mappedTasks,
      summary: { cachedFiles },
    })
  } catch (error) {
    console.error("Failed to list tasks:", error)
    return NextResponse.json({ error: "Failed to list tasks" }, { status: 500 })
  }
}
