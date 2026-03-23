import { NextRequest, NextResponse } from "next/server"
import { z } from "zod/v4"
import { auth } from "@/lib/auth"
import { getS3Client } from "@/lib/s3"
import { s3BucketSchema, s3KeySchema } from "@/lib/validations"
import {
  deleteObjectVersion,
  getS3ErrorCode,
  getS3ErrorMessage,
  isPermissionStyleS3Error,
} from "@/lib/s3-object-versions"

const deleteVersionBodySchema = z.object({
  bucket: s3BucketSchema,
  credentialId: z.string().optional(),
  key: s3KeySchema,
  versionId: z.string().min(1).max(1024),
})

export async function POST(request: NextRequest) {
  let userId: string | undefined
  let auditBucket = ""
  let auditKey = ""
  let auditVersionId = ""
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    userId = session.user.id
    const body = await request.json().catch(() => null)
    const parsed = deleteVersionBodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parameters", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { bucket, credentialId, key, versionId } = parsed.data
    auditBucket = bucket
    auditKey = key
    auditVersionId = versionId

    const { client, credential } = await getS3Client(session.user.id, credentialId)

    await deleteObjectVersion(client, bucket, key, versionId)
    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Failed to delete object version:", error)

    if (userId) {    }

    if (isPermissionStyleS3Error(error)) {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 })
    }

    return NextResponse.json(
      { error: "Failed to delete object version" },
      { status: 500 }
    )
  }
}
