import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getS3Client } from "@/lib/s3"
import { previewSchema } from "@/lib/validations"
import { GetObjectCommand } from "@aws-sdk/client-s3"

export const runtime = "nodejs"

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
    const parsed = previewSchema.safeParse({
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

    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    )

    if (!response.Body) {
      return NextResponse.json({ error: "Empty response from storage" }, { status: 502 })
    }
    const headers = new Headers()
    headers.set("Content-Disposition", "inline")
    if (response.ContentType) {
      headers.set("Content-Type", response.ContentType)
    }
    if (response.ContentLength != null) {
      headers.set("Content-Length", String(response.ContentLength))
    }
    headers.set("Cache-Control", "public, max-age=300")

    const webStream = response.Body.transformToWebStream()
    return new NextResponse(webStream, { status: 200, headers })
  } catch (error) {
    console.error("Preview proxy failed:", error)
    if (userId) {    }
    return NextResponse.json({ error: "Failed to preview object" }, { status: 500 })
  }
}
