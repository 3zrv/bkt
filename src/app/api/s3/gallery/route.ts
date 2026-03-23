import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getS3Client } from "@/lib/s3"
import { getMediaTypeFromExtension, getPreviewType, type MediaType } from "@/lib/media"
import { galleryListSchema } from "@/lib/validations"
import type { GalleryItem } from "@/types"

const PREVIEW_URL_TTL_SECONDS = 3600 // 1 hour

type CursorPayload = {
  offset: number
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url")
}

function decodeCursor(raw: string): CursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      offset?: unknown
    }

    if (typeof parsed.offset !== "number") return null
    if (!Number.isFinite(parsed.offset) || parsed.offset < 0) return null

    return { offset: Math.floor(parsed.offset) }
  } catch {
    return null
  }
}

interface FolderRow {
  folderKey: string
  lastModified: Date
  totalSize: bigint
  fileCount: bigint
}

interface FileRow {
  id: string
  key: string
  size: bigint
  lastModified: Date
  extension: string
}

export async function GET(request: NextRequest) {
  let userId: string | undefined
  let auditBucket = ""
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    userId = session.user.id
    const { searchParams } = request.nextUrl
    const parsed = galleryListSchema.safeParse({
      bucket: searchParams.get("bucket") ?? undefined,
      prefix: searchParams.get("prefix") ?? undefined,
      credentialId: searchParams.get("credentialId") ?? undefined,
      cursor: searchParams.get("cursor") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      mediaType: searchParams.get("mediaType") ?? undefined,
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parameters", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { bucket, credentialId, prefix = "", cursor, limit, mediaType } = parsed.data
    auditBucket = bucket
    const resolvedPrefix = prefix.trim()
    const cursorData = cursor ? decodeCursor(cursor) : { offset: 0 }

    if (!cursorData) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 })
    }

    const { client, credential } = await getS3Client(session.user.id, credentialId)
    const isStoradera = credential.provider.trim().toUpperCase() === "STORADERA"

    const prefixLen = resolvedPrefix.length + 1
    const likePrefix = resolvedPrefix + "%"
    const slashLike = "%/%"
    const prefixLenSql = Prisma.sql`${prefixLen}::int`

    // Get folders via SQL aggregation
    const folderRows = await prisma.$queryRaw<FolderRow[]>`
      SELECT
        ${resolvedPrefix} || SUBSTRING("key", ${prefixLenSql}, POSITION('/' IN SUBSTRING("key", ${prefixLenSql}))) AS "folderKey",
        MAX("lastModified") AS "lastModified",
        COALESCE(SUM(CASE WHEN "isFolder" = false THEN "size" ELSE 0 END), 0)::bigint AS "totalSize",
        COUNT(CASE WHEN "isFolder" = false THEN 1 END)::bigint AS "fileCount"
      FROM "FileMetadata"
      WHERE "userId" = ${session.user.id}
        AND "credentialId" = ${credential.id}
        AND "bucket" = ${bucket}
        AND "key" LIKE ${likePrefix}
        AND SUBSTRING("key", ${prefixLenSql}) LIKE ${slashLike}
        AND LENGTH("key") > ${resolvedPrefix.length}
      GROUP BY "folderKey"
      ORDER BY MAX("lastModified") DESC, "folderKey" ASC
    `

    // Build media type filter for direct files
    const mediaConditions: Prisma.Sql[] = [
      Prisma.sql`"userId" = ${session.user.id}`,
      Prisma.sql`"credentialId" = ${credential.id}`,
      Prisma.sql`"bucket" = ${bucket}`,
      Prisma.sql`"key" LIKE ${likePrefix}`,
      Prisma.sql`SUBSTRING("key", ${prefixLenSql}) NOT LIKE ${slashLike}`,
      Prisma.sql`LENGTH("key") > ${resolvedPrefix.length}`,
      Prisma.sql`"isFolder" = false`,
    ]

    // Only include files that have a media type or preview type
    // We approximate this by checking extension is not empty
    mediaConditions.push(Prisma.sql`"extension" != ''`)

    const fileRows = await prisma.$queryRaw<FileRow[]>`
      SELECT "id", "key", "size", "lastModified", "extension"
      FROM "FileMetadata"
      WHERE ${Prisma.join(mediaConditions, " AND ")}
      ORDER BY "lastModified" DESC, "key" ASC
    `

    // Filter files client-side for media type matching (extensions are small set)
    const filteredFiles = fileRows.filter((row) => {
      const entryMediaType = getMediaTypeFromExtension(row.extension)
      const entryPreviewType = getPreviewType(row.extension)
      if (!entryMediaType && !entryPreviewType) return false
      if (mediaType !== "all" && entryMediaType !== mediaType) return false
      return true
    })

    // Merge folders + files, apply cursor pagination
    type MergedItem = { kind: "folder"; data: FolderRow } | { kind: "file"; data: FileRow & { mediaType: MediaType | null } }
    const merged: MergedItem[] = [
      ...folderRows.map((f) => ({ kind: "folder" as const, data: f })),
      ...filteredFiles.map((f) => ({
        kind: "file" as const,
        data: { ...f, mediaType: getMediaTypeFromExtension(f.extension) },
      })),
    ]

    // Sort by lastModified desc
    merged.sort((a, b) => {
      const aTime = a.kind === "folder" ? a.data.lastModified.getTime() : a.data.lastModified.getTime()
      const bTime = b.kind === "folder" ? b.data.lastModified.getTime() : b.data.lastModified.getTime()
      if (bTime !== aTime) return bTime - aTime
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1
      const aKey = a.kind === "folder" ? a.data.folderKey : a.data.key
      const bKey = b.kind === "folder" ? b.data.folderKey : b.data.key
      return aKey.localeCompare(bKey)
    })

    const start = cursorData.offset
    const endExclusive = start + limit
    const pageCandidates = merged.slice(start, endExclusive)
    const hasMore = endExclusive < merged.length
    const nextCursor = hasMore ? encodeCursor(endExclusive) : null

    const items = await Promise.all(
      pageCandidates.map(async (candidate): Promise<GalleryItem> => {
        if (candidate.kind === "folder") {
          const f = candidate.data
          return {
            id: `folder:${f.folderKey}`,
            key: f.folderKey,
            size: Number(f.totalSize),
            lastModified: f.lastModified.toISOString(),
            extension: "",
            mediaType: null,
            previewUrl: null,
            isVideo: false,
            isFolder: true,
            fileCount: Number(f.fileCount),
            totalSize: Number(f.totalSize),
          }
        }

        const f = candidate.data
        let previewUrl: string | null = null

        if (f.mediaType) {
          if (isStoradera) {
            const params = new URLSearchParams({ bucket, key: f.key })
            if (credentialId) params.set("credentialId", credentialId)
            previewUrl = `/api/s3/preview/proxy?${params.toString()}`
          } else {
            try {
              previewUrl = await getSignedUrl(
                client,
                new GetObjectCommand({
                  Bucket: bucket,
                  Key: f.key,
                  ResponseContentDisposition: "inline",
                  ResponseCacheControl: `public, max-age=${PREVIEW_URL_TTL_SECONDS}`,
                }),
                { expiresIn: PREVIEW_URL_TTL_SECONDS }
              )
            } catch {
              previewUrl = null
            }
          }
        }

        return {
          id: f.id,
          key: f.key,
          size: Number(f.size),
          lastModified: f.lastModified.toISOString(),
          extension: f.extension,
          mediaType: f.mediaType,
          previewUrl,
          isVideo: f.mediaType === "video",
          isFolder: false,
          fileCount: undefined,
          totalSize: undefined,
        }
      })
    )
    return NextResponse.json({
      items,
      nextCursor,
      hasMore,
    })
  } catch (error) {
    console.error("Failed to list gallery items:", error)
    if (userId) {    }
    return NextResponse.json({ error: "Failed to list gallery items" }, { status: 500 })
  }
}
