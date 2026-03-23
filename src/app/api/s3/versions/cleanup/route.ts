import { NextRequest, NextResponse } from "next/server"
import { z } from "zod/v4"
import { auth } from "@/lib/auth"
import { getS3Client } from "@/lib/s3"
import { s3BucketSchema } from "@/lib/validations"
import {
  cleanupNoncurrentVersions,
  getS3ErrorCode,
  getS3ErrorMessage,
  isPermissionStyleS3Error,
} from "@/lib/s3-object-versions"

const cleanupBodySchema = z.object({
  bucket: s3BucketSchema,
  credentialId: z.string().optional(),
  retryAttempts: z.number().int().min(1).max(10).optional(),
})

export async function POST(request: NextRequest) {
  let userId: string | undefined
  let auditBucket = ""
  let auditCredentialId = ""
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    userId = session.user.id
    const body = await request.json().catch(() => null)
    const parsed = cleanupBodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parameters", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { bucket, credentialId, retryAttempts } = parsed.data
    auditBucket = bucket

    const { client, credential } = await getS3Client(session.user.id, credentialId)
    auditCredentialId = credential.id

    const result = await cleanupNoncurrentVersions(client, bucket, retryAttempts)
    return NextResponse.json({
      bucket,
      credentialId: credential.id,
      attemptedVersions: result.attemptedVersions,
      cleanedVersions: result.cleanedVersions,
      failedVersions: result.failedVersions,
      remaining: result.remaining,
    })
  } catch (error) {
    console.error("Failed to cleanup non-current versions:", error)

    if (userId) {    }

    if (isPermissionStyleS3Error(error)) {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 })
    }

    return NextResponse.json(
      { error: "Failed to cleanup non-current versions" },
      { status: 500 }
    )
  }
}
