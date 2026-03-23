function parseIntegerEnv(
  value: string | undefined,
  defaultValue: number,
  min: number,
  max: number
): number {
  if (!value) return defaultValue
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return defaultValue
  return Math.min(max, Math.max(min, parsed))
}

export function getTaskMissedScheduleGraceSeconds(): number {
  return parseIntegerEnv(process.env.TASK_MISSED_SCHEDULE_GRACE_SECONDS, 120, 5, 86_400)
}
