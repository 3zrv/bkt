import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  resolveTaskSchedule,
  nextRunAtForTaskSchedule,
} from "@/lib/task-schedule"

type RouteContext = { params: Promise<{ taskId: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { taskId } = await context.params
    const body = await request.json()
    const action = typeof body.action === "string" ? body.action : ""

    const task = await prisma.task.findUnique({ where: { id: taskId } })
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    switch (action) {
      case "pause": {
        if (task.status !== "pending" && task.status !== "running") {
          return NextResponse.json({ error: "Task cannot be paused" }, { status: 400 })
        }
        await prisma.task.update({
          where: { id: taskId },
          data: {
            status: "paused",
            nextRunAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          },
        })
        return NextResponse.json({ ok: true })
      }

      case "resume": {
        if (task.status !== "paused") {
          return NextResponse.json({ error: "Task is not paused" }, { status: 400 })
        }
        const schedule = resolveTaskSchedule(task)
        const nextRunAt = schedule.enabled
          ? (nextRunAtForTaskSchedule(schedule, new Date()) ?? new Date())
          : new Date()
        await prisma.task.update({
          where: { id: taskId },
          data: { status: "pending", nextRunAt, error: null },
        })
        return NextResponse.json({ ok: true })
      }

      case "restart": {
        if (task.status === "running") {
          return NextResponse.json({ error: "Task is currently running" }, { status: 400 })
        }
        await prisma.task.update({
          where: { id: taskId },
          data: {
            status: "pending",
            progress: Prisma.DbNull,
            error: null,
            completedAt: null,
            nextRunAt: new Date(),
          },
        })
        return NextResponse.json({ ok: true })
      }

      case "cancel": {
        if (task.status === "running") {
          return NextResponse.json({ error: "Cannot cancel a running task" }, { status: 400 })
        }
        await prisma.task.update({
          where: { id: taskId },
          data: {
            status: "completed",
            completedAt: new Date(),
            nextRunAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          },
        })
        return NextResponse.json({ ok: true })
      }

      case "update_schedule": {
        const cron = typeof body.scheduleCron === "string" ? body.scheduleCron.trim() : null
        if (!cron) {
          return NextResponse.json({ error: "scheduleCron is required" }, { status: 400 })
        }
        const schedule = resolveTaskSchedule({ isRecurring: true, scheduleCron: cron })
        const nextRunAt = nextRunAtForTaskSchedule(schedule, new Date()) ?? new Date()
        await prisma.task.update({
          where: { id: taskId },
          data: { scheduleCron: cron, nextRunAt },
        })
        return NextResponse.json({ ok: true })
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 })
    }
  } catch (error) {
    console.error("Failed to update task:", error)
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { taskId } = await context.params
    const task = await prisma.task.findUnique({ where: { id: taskId } })
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    if (task.status === "running") {
      return NextResponse.json({ error: "Cannot delete a running task" }, { status: 400 })
    }

    await prisma.task.delete({ where: { id: taskId } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Failed to delete task:", error)
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 })
  }
}
