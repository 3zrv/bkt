import { NextResponse } from "next/server"

export async function GET() {
  const checks: Record<string, "ok" | "error" | "n/a"> = {}

  if (process.env.SANDBOX_MODE) {
    checks.database = "n/a"
  } else {
    const { prisma } = await import("@/lib/db")
    try {
      await prisma.$queryRaw`SELECT 1`
      checks.database = "ok"
    } catch {
      checks.database = "error"
    }
  }

  const healthy = Object.values(checks).every((v) => v === "ok" || v === "n/a")

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks },
    { status: healthy ? 200 : 503 }
  )
}
