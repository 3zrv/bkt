import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getS3Client } from "@/lib/s3"
import { bucketManageSchema } from "@/lib/validations"
import {
  getS3ErrorCode,
  getS3ErrorMessage,
  isPermissionStyleS3Error,
  scanNoncurrentVersions,
  scanNoncurrentVersionsPage,
} from "@/lib/s3-object-versions"

function parseBooleanParam(
  raw: string | null,
  defaultValue: boolean
): { ok: true; value: boolean } | { ok: false } {
  if (raw === null) return { ok: true, value: defaultValue }
  if (raw === "true") return { ok: true, value: true }
  if (raw === "false") return { ok: true, value: false }
  return { ok: false }
}

function parseLimitParam(
  raw: string | null
): { ok: true; limit: number } | { ok: false } {
  if (raw === null || raw.trim().length === 0) return { ok: true, limit: 50 }
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) return { ok: false }
  return { ok: true, limit: parsed }
}

export async function GET(request: NextRequest) {
  let userId: string | undefined
  let auditBucket = ""
  let auditCredentialId = ""
  let details = false
  let includeSummary = false
  let limit = 50
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    userId = session.user.id
    const detailsParse = parseBooleanParam(
      request.nextUrl.searchParams.get("details"),
      false
    )
    if (!detailsParse.ok) {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
    }
    details = detailsParse.value

    const includeSummaryParse = parseBooleanParam(
      request.nextUrl.searchParams.get("includeSummary"),
      false
    )
    if (!includeSummaryParse.ok) {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
    }
    includeSummary = includeSummaryParse.value

    const limitParse = parseLimitParam(request.nextUrl.searchParams.get("limit"))
    if (!limitParse.ok) {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
    }
    limit = limitParse.limit

    const parsed = bucketManageSchema.safeParse({
      bucket: request.nextUrl.searchParams.get("bucket") ?? undefined,
      credentialId: request.nextUrl.searchParams.get("credentialId") ?? undefined,
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parameters", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { bucket, credentialId } = parsed.data
    auditBucket = bucket

    const { client, credential } = await getS3Client(session.user.id, credentialId)
    auditCredentialId = credential.id

    if (details) {
      const keyMarker = request.nextUrl.searchParams.get("keyMarker") ?? undefined
      const versionIdMarker = request.nextUrl.searchParams.get("versionIdMarker") ?? undefined

      const pageScan = await scanNoncurrentVersionsPage(client, bucket, {
        limit,
        keyMarker,
        versionIdMarker,
      })

      const summary = includeSummary
        ? (await scanNoncurrentVersions(client, bucket, false)).summary
        : null
      return NextResponse.json({
        bucket,
        credentialId: credential.id,
        summary,
        versions: pageScan.versions,
        pagination: {
          hasMore: pageScan.hasMore,
          limit,
          nextKeyMarker: pageScan.nextKeyMarker,
          nextVersionIdMarker: pageScan.nextVersionIdMarker,
        },
      })
    }

    const scan = await scanNoncurrentVersions(client, bucket, false)
    return NextResponse.json({
      bucket,
      credentialId: credential.id,
      summary: scan.summary,
      versions: [],
    })
  } catch (error) {
    console.error("Failed to scan non-current versions:", error)

    if (userId) {    }

    if (isPermissionStyleS3Error(error)) {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 })
    }

    return NextResponse.json(
      { error: "Failed to scan non-current versions" },
      { status: 500 }
    )
  }
}
