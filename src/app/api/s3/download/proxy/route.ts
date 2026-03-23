import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getS3Client } from "@/lib/s3"
import { s3OperationSchema } from "@/lib/validations"
import { GetObjectCommand } from "@aws-sdk/client-s3"

export const runtime = "nodejs"

function extractFilename(key: string): string {
  const normalized = key.endsWith("/") ? key.slice(0, -1) : key
  const filename = normalized.split("/").pop() || "download"
  return filename || "download"
}

function toContentDispositionFilename(filename: string): string {
  return filename.replace(/["\\]/g, "_")
}

export async function GET(request: NextRequest) {
  let userId: string | undefined
  let auditBucket = ""
  let auditKey = ""
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    userId = session.user.id
    const parsed = s3OperationSchema.safeParse({
      bucket: request.nextUrl.searchParams.get("bucket") ?? "",
      key: request.nextUrl.searchParams.get("key") ?? "",
      credentialId: request.nextUrl.searchParams.get("credentialId") ?? undefined,
    })
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
    }

    const { bucket, key, credentialId } = parsed.data
    auditBucket = bucket
    auditKey = key

    const { client } = await getS3Client(session.user.id, credentialId)
    const filename = extractFilename(key)

    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    )

    if (!response.Body) {
      return NextResponse.json({ error: "Empty response from storage" }, { status: 502 })
    }
    const headers = new Headers()
    headers.set(
      "Content-Disposition",
      `attachment; filename="${toContentDispositionFilename(filename)}"`
    )
    if (response.ContentType) {
      headers.set("Content-Type", response.ContentType)
    }
    if (response.ContentLength != null) {
      headers.set("Content-Length", String(response.ContentLength))
    }

    const webStream = response.Body.transformToWebStream()
    return new NextResponse(webStream, { status: 200, headers })
  } catch (error) {
    console.error("Download proxy failed:", error)
    if (userId) {    }
    return NextResponse.json({ error: "Failed to download object" }, { status: 500 })
  }
}
