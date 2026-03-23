import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getS3Client } from "@/lib/s3"
import { prisma } from "@/lib/db"
import { getObjectExtension, rebuildUserExtensionStats } from "@/lib/file-stats"
import { moveObjectSchema } from "@/lib/validations"
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3"
import type { S3Client } from "@aws-sdk/client-s3"

const MOVE_CONCURRENCY = 5

async function copyAndDelete(
  client: S3Client,
  fromBucket: string,
  toBucket: string,
  fromKey: string,
  toKey: string
): Promise<void> {
  await client.send(
    new CopyObjectCommand({
      Bucket: toBucket,
      CopySource: encodeURIComponent(`${fromBucket}/${fromKey}`),
      Key: toKey,
    })
  )
  await client.send(
    new DeleteObjectCommand({
      Bucket: fromBucket,
      Key: fromKey,
    })
  )
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<{ succeeded: number; failed: { item: T; error: string }[] }> {
  let succeeded = 0
  const failed: { item: T; error: string }[] = []
  let nextIndex = 0

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = nextIndex++
      if (idx >= items.length) break
      try {
        await fn(items[idx]!)
        succeeded++
      } catch (error) {
        failed.push({
          item: items[idx]!,
          error: error instanceof Error ? error.message : "Unknown error",
        })
      }
    }
  })

  await Promise.all(workers)
  return { succeeded, failed }
}

export async function POST(request: NextRequest) {
  let userId: string | undefined
  let auditBucket = ""
  let auditSourceBucket = ""
  let auditOperationCount = 0
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    userId = session.user.id
    const body = await request.json()
    const parsed = moveObjectSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parameters", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { bucket, credentialId, sourceBucket, operations } = parsed.data
    const fromBucket = sourceBucket ?? bucket
    auditBucket = bucket
    auditSourceBucket = fromBucket
    auditOperationCount = operations.length
    const { client, credential } = await getS3Client(session.user.id, credentialId)

    // Expand folder operations into individual file moves
    const expandedMoves: { from: string; to: string }[] = []

    for (const { from, to } of operations) {
      const isFolder = from.endsWith("/")

      if (isFolder) {
        let continuationToken: string | undefined
        do {
          const listResponse = await client.send(
            new ListObjectsV2Command({
              Bucket: fromBucket,
              Prefix: from,
              ContinuationToken: continuationToken,
            })
          )
          for (const obj of listResponse.Contents ?? []) {
            if (!obj.Key) continue
            expandedMoves.push({ from: obj.Key, to: to + obj.Key.slice(from.length) })
          }
          continuationToken = listResponse.IsTruncated
            ? listResponse.NextContinuationToken
            : undefined
        } while (continuationToken)
      } else {
        expandedMoves.push({ from, to })
      }
    }

    // Execute moves with concurrency limit
    const result = await runWithConcurrency(
      expandedMoves,
      MOVE_CONCURRENCY,
      async (move) => {
        await copyAndDelete(client, fromBucket, bucket, move.from, move.to)

        // Update FileMetadata entry
        await prisma.fileMetadata.updateMany({
          where: {
            userId: session.user.id,
            credentialId: credential.id,
            bucket: fromBucket,
            key: move.from,
          },
          data: {
            bucket,
            key: move.to,
            extension: getObjectExtension(move.to, move.to.endsWith("/")),
          },
        })
      }
    )

    await rebuildUserExtensionStats(session.user.id)
    return NextResponse.json({
      moved: result.succeeded,
      failed: result.failed.length,
      errors: result.failed.length > 0
        ? result.failed.map((f) => ({ from: f.item.from, to: f.item.to, error: f.error }))
        : undefined,
    })
  } catch (error) {
    console.error("Failed to move objects:", error)
    if (userId) {    }
    return NextResponse.json({ error: "Failed to move objects" }, { status: 500 })
  }
}
