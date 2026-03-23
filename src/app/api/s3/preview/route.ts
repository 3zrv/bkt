import { NextRequest, NextResponse } from "next/server"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { auth } from "@/lib/auth"
import { getS3Client } from "@/lib/s3"
import { previewSchema } from "@/lib/validations"
const PREVIEW_URL_TTL_SECONDS = 86400 // 24 hours

export async function POST(request: NextRequest) {
  let userId: string | undefined
  let auditBucket = ""
  let auditKey = ""
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    userId = session.user.id
    const body = await request.json()
    const parsed = previewSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parameters", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { bucket, key, credentialId } = parsed.data
    auditBucket = bucket
    auditKey = key
    const { client, credential } = await getS3Client(session.user.id, credentialId)
    const ttlSeconds = PREVIEW_URL_TTL_SECONDS
    const isStoradera = credential.provider.trim().toUpperCase() === "STORADERA"

    let url: string
    if (isStoradera) {
      const params = new URLSearchParams({ bucket, key })
      if (credentialId) {
        params.set("credentialId", credentialId)
      }
      url = `/api/s3/preview/proxy?${params.toString()}`
    } else {
      url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: "inline",
          ResponseCacheControl: `public, max-age=${ttlSeconds}`,
        }),
        { expiresIn: ttlSeconds }
      )
    }
    return NextResponse.json({ url })
  } catch (error) {
    console.error("Failed to create preview URL:", error)
    if (userId) {    }
    return NextResponse.json({ error: "Failed to create preview URL" }, { status: 500 })
  }
}
