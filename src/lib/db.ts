import { Prisma, PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { logSystemEvent } from "@/lib/system-logger"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  if (!process.env.DATABASE_URL) {
    // Sandbox mode — no database. Return a proxy that surfaces a clear error
    // if an API route is accidentally called without a DB.
    return new Proxy({} as PrismaClient, {
      get() {
        throw new Error(
          "No DATABASE_URL set. Run in sandbox mode (/sandbox) or provide a database connection."
        )
      },
    })
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const client = new PrismaClient({
    adapter,
    log: [
      { emit: "event", level: "warn" },
      { emit: "event", level: "error" },
    ],
  })

  client.$on("warn", (event: Prisma.LogEvent) => {
    void logSystemEvent({
      source: "db",
      level: "warn",
      message: event.message,
      metadata: {
        target: event.target ?? null,
        timestamp: event.timestamp?.toISOString?.() ?? null,
      },
    })
  })

  client.$on("error", (event: Prisma.LogEvent) => {
    void logSystemEvent({
      source: "db",
      level: "error",
      message: event.message,
      metadata: {
        target: event.target ?? null,
        timestamp: event.timestamp?.toISOString?.() ?? null,
      },
    })
  })

  return client
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
