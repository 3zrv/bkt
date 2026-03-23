import { PutObjectCommand } from "@aws-sdk/client-s3"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getS3Client } from "@/lib/s3"
import { s3OperationSchema } from "@/lib/validations"

export const runtime = "nodejs"

export async function PUT(request: NextRequest) {
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

    if (!request.body) {
      return NextResponse.json({ error: "Missing upload body" }, { status: 400 })
    }

    const { client } = await getS3Client(session.user.id, credentialId)
    const contentTypeHeader = request.headers.get("content-type")?.trim()
    const bodyBuffer = Buffer.from(await request.arrayBuffer())

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bodyBuffer,
        ContentType: contentTypeHeader || undefined,
        ContentLength: bodyBuffer.length,
      })
    )
    return NextResponse.json({ uploaded: true, key })
  } catch (error) {
    console.error("Proxy upload failed:", error)

    if (userId) {    }

    return NextResponse.json({ error: "Failed to upload object" }, { status: 500 })
  }
}
