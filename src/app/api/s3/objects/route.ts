import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getS3Client } from "@/lib/s3"
import { listObjectsSchema } from "@/lib/validations"

interface FolderRow {
  folderKey: string
  lastModified: Date
  totalSize: bigint
  fileCount: bigint
}

interface FileRow {
  key: string
  size: bigint
  lastModified: Date
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = request.nextUrl
    const parsed = listObjectsSchema.safeParse({
      bucket: searchParams.get("bucket") ?? undefined,
      prefix: searchParams.get("prefix") ?? undefined,
      credentialId: searchParams.get("credentialId") ?? undefined,
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parameters", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { bucket, prefix, credentialId } = parsed.data
    const { credential } = await getS3Client(session.user.id, credentialId)
    const normalizedPrefix = prefix ?? ""
    const prefixLen = normalizedPrefix.length + 1 // +1 for SQL 1-based indexing
    const likePrefix = normalizedPrefix + "%"
    const slashLike = "%/%"

    // Get folders: group by first path segment after prefix using SQL.
    // Use Prisma.sql for the integer to ensure it's bound as int, not text.
    const prefixLenSql = Prisma.sql`${prefixLen}::int`

    const folderRows = await prisma.$queryRaw<FolderRow[]>`
      SELECT
        ${normalizedPrefix} || SUBSTRING("key", ${prefixLenSql}, POSITION('/' IN SUBSTRING("key", ${prefixLenSql}))) AS "folderKey",
        MAX("lastModified") AS "lastModified",
        COALESCE(SUM(CASE WHEN "isFolder" = false THEN "size" ELSE 0 END), 0)::bigint AS "totalSize",
        COUNT(CASE WHEN "isFolder" = false THEN 1 END)::bigint AS "fileCount"
      FROM "FileMetadata"
      WHERE "userId" = ${session.user.id}
        AND "credentialId" = ${credential.id}
        AND "bucket" = ${bucket}
        AND "key" LIKE ${likePrefix}
        AND SUBSTRING("key", ${prefixLenSql}) LIKE ${slashLike}
        AND LENGTH("key") > ${normalizedPrefix.length}
      GROUP BY "folderKey"
      ORDER BY "folderKey" ASC
    `

    // Get direct files (no slash in remainder after prefix, excluding folders)
    const fileRows = await prisma.$queryRaw<FileRow[]>`
      SELECT "key", "size", "lastModified"
      FROM "FileMetadata"
      WHERE "userId" = ${session.user.id}
        AND "credentialId" = ${credential.id}
        AND "bucket" = ${bucket}
        AND "key" LIKE ${likePrefix}
        AND SUBSTRING("key", ${prefixLenSql}) NOT LIKE ${slashLike}
        AND LENGTH("key") > ${normalizedPrefix.length}
        AND "isFolder" = false
      ORDER BY "key" ASC
    `

    const folders = folderRows.map((row) => ({
      key: row.folderKey,
      size: Number(row.totalSize),
      lastModified: row.lastModified.toISOString(),
      isFolder: true,
      totalSize: Number(row.totalSize),
      fileCount: Number(row.fileCount),
    }))

    const files = fileRows.map((row) => ({
      key: row.key,
      size: Number(row.size),
      lastModified: row.lastModified.toISOString(),
      isFolder: false,
    }))

    return NextResponse.json({ folders, files })
  } catch (error) {
    console.error("Failed to list objects:", error)
    return NextResponse.json({ error: "Failed to list objects" }, { status: 500 })
  }
}
