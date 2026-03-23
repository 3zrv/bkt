import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getS3Client } from "@/lib/s3"
import { getObjectExtension, rebuildUserExtensionStats } from "@/lib/file-stats"

interface UploadCompleteItem {
  key: string
  size: number
  lastModified?: string
}

export async function POST(request: NextRequest) {
  let userId: string | undefined
  let auditBucket = ""
  let auditItemsCount = 0
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    userId = session.user.id

    const body = await request.json()
    const bucket = typeof body?.bucket === "string" ? body.bucket : ""
    const credentialId = typeof body?.credentialId === "string" ? body.credentialId : undefined
    const items = Array.isArray(body?.items) ? (body.items as UploadCompleteItem[]) : []
    auditBucket = bucket
    auditItemsCount = items.length

    if (!bucket || items.length === 0) {
      return NextResponse.json(
        { error: "bucket and items are required" },
        { status: 400 }
      )
    }

    const { credential } = await getS3Client(session.user.id, credentialId)

    const normalizedItems = items.filter(
      (item): item is UploadCompleteItem => Boolean(item?.key && typeof item.key === "string")
    )
    if (normalizedItems.length === 0) {
      return NextResponse.json({ error: "No valid upload items were provided" }, { status: 400 })
    }

    // Batch upsert using INSERT ... ON CONFLICT
    const values = normalizedItems.map((item) => {
      const size = Number.isFinite(item.size) && item.size >= 0 ? item.size : 0
      const lastModified = item.lastModified ? new Date(item.lastModified) : new Date()
      return Prisma.sql`(gen_random_uuid(), ${session.user.id}, ${credential.id}, ${bucket}, ${item.key}, ${getObjectExtension(item.key, false)}, ${BigInt(size)}, ${lastModified}::timestamptz, false)`
    })

    await prisma.$executeRaw`
      INSERT INTO "FileMetadata" ("id", "userId", "credentialId", "bucket", "key", "extension", "size", "lastModified", "isFolder")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("credentialId", "bucket", "key")
      DO UPDATE SET
        "extension" = EXCLUDED."extension",
        "size" = EXCLUDED."size",
        "lastModified" = EXCLUDED."lastModified",
        "isFolder" = EXCLUDED."isFolder"
    `

    await rebuildUserExtensionStats(session.user.id)
    return NextResponse.json({ updated: normalizedItems.length })
  } catch (error) {
    console.error("Failed to finalize uploaded metadata:", error)
    if (userId) {    }
    return NextResponse.json({ error: "Failed to finalize uploaded metadata" }, { status: 500 })
  }
}
