import { NextRequest, NextResponse } from "next/server"
import { z } from "zod/v4"
import { auth } from "@/lib/auth"
import { getS3Client } from "@/lib/s3"
import { bucketManageSchema } from "@/lib/validations"
import {
  cleanupIncompleteMultipart,
  getS3ErrorCode,
  getS3ErrorMessage,
  isPermissionStyleS3Error,
} from "@/lib/s3-multipart-incomplete"

const multipartCleanupSchema = bucketManageSchema.extend({
  retryAttempts: z.number().int().min(1).max(10).optional(),
})

export async function POST(request: NextRequest) {
  let userId: string | undefined
  let auditBucket = ""
  let auditCredentialId = ""
  let retryAttempts = 3
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    userId = session.user.id
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
    }
    const parsed = multipartCleanupSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parameters", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { bucket, credentialId, retryAttempts: requestedRetryAttempts } = parsed.data
    auditBucket = bucket
    retryAttempts = requestedRetryAttempts ?? 3

    const { client, credential } = await getS3Client(session.user.id, credentialId)
    auditCredentialId = credential.id

    const cleanup = await cleanupIncompleteMultipart(client, bucket, retryAttempts)
    return NextResponse.json({
      bucket,
      credentialId: credential.id,
      attemptedUploads: cleanup.attemptedUploads,
      cleanedUploads: cleanup.cleanedUploads,
      failedUploads: cleanup.failedUploads,
      remaining: cleanup.remaining,
    })
  } catch (error) {
    console.error("Failed to cleanup incomplete multipart uploads:", error)

    if (userId) {    }

    if (isPermissionStyleS3Error(error)) {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 })
    }

    return NextResponse.json(
      { error: "Failed to cleanup incomplete multipart uploads" },
      { status: 500 }
    )
  }
}
