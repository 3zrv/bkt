import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  buildFileSearchSqlWhereClause,
  parseScopes,
} from "@/lib/file-search"
import {
  assertValidTaskScheduleCron,
  TaskScheduleValidationError,
} from "@/lib/task-schedule"

interface BulkDeletePayload {
  query: string
  selectedType?: string
  selectedCredentialIds?: string[]
  selectedBucketScopes?: string[]
  schedule?: { cron?: string } | null
  confirmDestructiveSchedule?: boolean
  previewOnly?: boolean
}

interface CountRow {
  total: bigint
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = (await request.json()) as BulkDeletePayload
    const previewOnly = Boolean(body?.previewOnly)
    const query = typeof body?.query === "string" ? body.query.trim() : ""
    const selectedType = typeof body?.selectedType === "string" ? body.selectedType : "all"
    const selectedCredentialIds = Array.isArray(body?.selectedCredentialIds)
      ? body.selectedCredentialIds.filter((v): v is string => typeof v === "string")
      : []
    const selectedBucketScopes = Array.isArray(body?.selectedBucketScopes)
      ? body.selectedBucketScopes.filter((v): v is string => typeof v === "string")
      : []
    let scheduleCron: string | null = null
    if (body?.schedule && typeof body.schedule === "object" && typeof body.schedule.cron === "string") {
      scheduleCron = assertValidTaskScheduleCron(body.schedule.cron)
    }

    const normalizedCredentialIds = Array.from(new Set(selectedCredentialIds)).sort()
    const normalizedBucketScopes = Array.from(new Set(selectedBucketScopes)).sort()

    if (query.length < 2) {
      return NextResponse.json({ error: "query must be at least 2 characters" }, { status: 400 })
    }

    const whereClause = buildFileSearchSqlWhereClause({
      userId: session.user.id,
      query,
      credentialIds: normalizedCredentialIds,
      scopes: parseScopes(normalizedBucketScopes),
      type: selectedType,
    })
    const [countResult] = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS "total" FROM "FileMetadata" fm WHERE ${whereClause}
    `)
    const total = Number(countResult?.total ?? 0)

    if (total === 0) {
      return NextResponse.json({ error: "No indexed files matched this selection" }, { status: 400 })
    }

    // Check for existing active bulk delete with same query
    const existingTask = await prisma.task.findFirst({
      where: {
        type: "bulk_delete",
        status: { in: ["pending", "running"] },
      },
      select: { id: true, type: true, title: true, status: true, progress: true },
    })

    const sampleObjects = previewOnly
      ? (await prisma.$queryRaw<{ bucket: string; key: string }[]>(Prisma.sql`
          SELECT fm."bucket", fm."key" FROM "FileMetadata" fm WHERE ${whereClause} ORDER BY fm."id" ASC LIMIT 12
        `)).map((r) => `${r.bucket}/${r.key}`)
      : []

    if (previewOnly) {
      return NextResponse.json({
        preview: {
          type: "bulk_delete",
          summary: [
            `Search query: "${query}"`,
            `File type filter: ${selectedType}`,
            `Estimated matching objects: ${total.toLocaleString()}`,
            scheduleCron ? `Schedule: CRON (${scheduleCron}) UTC` : "Schedule: one-time run",
          ],
          estimatedObjects: total,
          sampleObjects,
          warnings: [
            "Bulk delete permanently removes matched objects from object storage.",
            ...(existingTask ? ["An equivalent bulk delete task is already queued or running."] : []),
          ],
        },
        duplicate: Boolean(existingTask),
        task: existingTask ?? null,
      })
    }

    if (scheduleCron && !body.confirmDestructiveSchedule) {
      return NextResponse.json({ error: "Recurring bulk delete requires explicit confirmation" }, { status: 400 })
    }

    if (existingTask) {
      return NextResponse.json({ task: existingTask, duplicate: true })
    }

    const task = await prisma.task.create({
      data: {
        type: "bulk_delete",
        title: `Bulk delete: ${query}`,
        status: "pending",
        payload: {
          query,
          selectedType,
          selectedCredentialIds: normalizedCredentialIds,
          selectedBucketScopes: normalizedBucketScopes,
        },
        isRecurring: Boolean(scheduleCron),
        scheduleCron,
        progress: { total, deleted: 0, remaining: total, cursorId: null },
      },
      select: { id: true, type: true, title: true, status: true, progress: true },
    })

    return NextResponse.json({ task })
  } catch (error) {
    console.error("Failed to create bulk delete task:", error)
    if (error instanceof TaskScheduleValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    const message = error instanceof Error ? error.message : "Failed to create bulk delete task"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
