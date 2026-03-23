import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function GET() {
  const checks: Record<string, "ok" | "error"> = {}

  try {
    await prisma.$queryRaw`SELECT 1`
    checks.database = "ok"
  } catch {
    checks.database = "error"
  }

  const healthy = Object.values(checks).every((v) => v === "ok")

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks },
    { status: healthy ? 200 : 503 }
  )
}
