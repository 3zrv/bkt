import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { getS3Client } from "@/lib/s3"
import { prisma } from "@/lib/db"
import { getObjectExtension, rebuildUserExtensionStats } from "@/lib/file-stats"
import { ListObjectsV2Command } from "@aws-sdk/client-s3"

const UPSERT_BATCH_SIZE = 500

export async function POST(request: NextRequest) {
  let userId: string | undefined
  let auditBucket = ""
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    userId = session.user.id

    const body = await request.json()
    const { bucket, credentialId } = body
    auditBucket = bucket

    if (!bucket) {
      return NextResponse.json(
        { error: "bucket is required" },
        { status: 400 }
      )
    }

    const { client, credential } = await getS3Client(session.user.id, credentialId)

    // Paginate through all objects in the bucket
    const s3Objects: {
      key: string
      extension: string
      size: number
      lastModified: Date
      isFolder: boolean
    }[] = []
    let continuationToken: string | undefined

    do {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: continuationToken,
        })
      )

      for (const obj of response.Contents ?? []) {
        if (!obj.Key) continue
        s3Objects.push({
          key: obj.Key,
          extension: getObjectExtension(
            obj.Key,
            obj.Key.endsWith("/") && (obj.Size ?? 0) === 0
          ),
          size: obj.Size ?? 0,
          lastModified: obj.LastModified ?? new Date(),
          isFolder: obj.Key.endsWith("/") && (obj.Size ?? 0) === 0,
        })
      }

      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined
    } while (continuationToken)

    const totalInS3 = s3Objects.length

    // Batch upsert using INSERT ... ON CONFLICT for dramatically better performance
    let synced = 0
    for (let i = 0; i < s3Objects.length; i += UPSERT_BATCH_SIZE) {
      const batch = s3Objects.slice(i, i + UPSERT_BATCH_SIZE)
      if (batch.length === 0) continue

      const values = batch.map(
        (obj) =>
          Prisma.sql`(gen_random_uuid(), ${session.user.id}, ${credential.id}, ${bucket}, ${obj.key}, ${obj.extension}, ${BigInt(obj.size)}, ${obj.lastModified}::timestamptz, ${obj.isFolder})`
      )

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
      synced += batch.length
    }

    // Delete FileMetadata entries for objects no longer in S3
    const s3KeySet = new Set(s3Objects.map((o) => o.key))
    const existingKeys = await prisma.fileMetadata.findMany({
      where: {
        userId: session.user.id,
        credentialId: credential.id,
        bucket,
      },
      select: { id: true, key: true },
    })
    const staleIds = existingKeys.filter((e) => !s3KeySet.has(e.key)).map((e) => e.id)

    if (staleIds.length > 0) {
      await prisma.fileMetadata.deleteMany({
        where: { id: { in: staleIds } },
      })
    }

    await rebuildUserExtensionStats(session.user.id)
    return NextResponse.json({ synced, total: totalInS3 })
  } catch (error) {
    console.error("Failed to sync metadata:", error)
    if (userId) {    }
    return NextResponse.json({ error: "Failed to sync metadata" }, { status: 500 })
  }
}
