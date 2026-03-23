import { describe, it, expect } from "vitest"
import {
  normalizeTaskScheduleCron,
  assertValidTaskScheduleCron,
  resolveTaskSchedule,
  nextRunAtForTaskSchedule,
  getUpcomingRunDatesFromCron,
  TaskScheduleValidationError,
} from "@/lib/task-schedule"

describe("normalizeTaskScheduleCron", () => {
  it("trims and normalizes whitespace", () => {
    expect(normalizeTaskScheduleCron("  0  */3  *  *  *  ")).toBe("0 */3 * * *")
  })

  it("throws for empty string", () => {
    expect(() => normalizeTaskScheduleCron("")).toThrow(TaskScheduleValidationError)
  })

  it("throws for whitespace only", () => {
    expect(() => normalizeTaskScheduleCron("   ")).toThrow(TaskScheduleValidationError)
  })

  it("throws for too long cron", () => {
    expect(() => normalizeTaskScheduleCron("a".repeat(200))).toThrow(TaskScheduleValidationError)
  })
})

describe("assertValidTaskScheduleCron", () => {
  it("accepts valid hourly cron", () => {
    expect(assertValidTaskScheduleCron("0 */3 * * *")).toBe("0 */3 * * *")
  })

  it("accepts daily cron", () => {
    expect(assertValidTaskScheduleCron("0 0 * * *")).toBe("0 0 * * *")
  })

  it("rejects invalid cron syntax", () => {
    expect(() => assertValidTaskScheduleCron("not a cron")).toThrow()
  })

  it("rejects too-frequent cron (< 1 hour)", () => {
    expect(() => assertValidTaskScheduleCron("* * * * *")).toThrow()
    expect(() => assertValidTaskScheduleCron("*/5 * * * *")).toThrow()
  })
})

describe("resolveTaskSchedule", () => {
  it("returns enabled for recurring task with cron", () => {
    const schedule = resolveTaskSchedule({ isRecurring: true, scheduleCron: "0 */3 * * *" })
    expect(schedule.enabled).toBe(true)
    expect(schedule.cron).toBe("0 */3 * * *")
  })

  it("returns disabled for non-recurring task", () => {
    const schedule = resolveTaskSchedule({ isRecurring: false, scheduleCron: null })
    expect(schedule.enabled).toBe(false)
  })

  it("returns disabled for recurring task with no cron", () => {
    const schedule = resolveTaskSchedule({ isRecurring: true, scheduleCron: null })
    expect(schedule.enabled).toBe(false)
  })
})

describe("nextRunAtForTaskSchedule", () => {
  it("returns next run for enabled schedule", () => {
    const schedule = resolveTaskSchedule({ isRecurring: true, scheduleCron: "0 */3 * * *" })
    const now = new Date("2026-03-23T12:00:00.000Z")
    const next = nextRunAtForTaskSchedule(schedule, now)
    expect(next).toBeInstanceOf(Date)
    expect(next!.getTime()).toBeGreaterThan(now.getTime())
  })

  it("returns null for disabled schedule", () => {
    const schedule = resolveTaskSchedule({ isRecurring: false, scheduleCron: null })
    const next = nextRunAtForTaskSchedule(schedule, new Date())
    expect(next).toBeNull()
  })
})

describe("getUpcomingRunDatesFromCron", () => {
  it("returns requested number of dates", () => {
    const from = new Date("2026-03-23T12:00:00.000Z")
    const dates = getUpcomingRunDatesFromCron("0 */3 * * *", from, 5)
    expect(dates).toHaveLength(5)
    for (const d of dates) {
      expect(new Date(d).getTime()).toBeGreaterThanOrEqual(from.getTime())
    }
  })

  it("returns dates in ascending order", () => {
    const dates = getUpcomingRunDatesFromCron("0 0 * * *", new Date("2026-01-01T00:00:00Z"), 3)
    for (let i = 1; i < dates.length; i++) {
      expect(new Date(dates[i]).getTime()).toBeGreaterThan(new Date(dates[i - 1]).getTime())
    }
  })
})
