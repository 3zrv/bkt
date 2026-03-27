import { NextRequest, NextResponse } from "next/server"
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3"
import { z } from "zod"
import type { S3Object } from "@/types"

// ---------------------------------------------------------------------------
// Shared helpers (same logic as discover-buckets / ensure-cors routes)
// ---------------------------------------------------------------------------

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"])

function normalizeEndpoint(raw: string): string {
  const trimmed = raw.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, "")
  const hostname = trimmed.split("/")[0]?.split(":")[0]?.toLowerCase() ?? ""
  const proto = LOCAL_HOSTS.has(hostname) ? "http" : "https"
  return new URL(`${proto}://${trimmed}`).toString().replace(/\/+$/, "")
}

function resolveRegion(provider: string, region?: string): string {
  const r = region?.trim() ?? ""
  if (r) return r
  const p = provider.trim().toUpperCase()
  if (p === "MINIO" || p === "GENERIC") return "us-east-1"
  throw new Error("Region is required for this provider")
}

const FIXED_SIGNING_REGIONS: Record<string, string> = { STORADERA: "us-east-1" }

function makeClient(
  endpoint: string,
  region: string,
  provider: string,
  accessKeyId: string,
  secretAccessKey: string
): S3Client {
  const normalizedEndpoint = normalizeEndpoint(endpoint)
  const normalizedRegion = resolveRegion(provider, region)
  const signingRegion = FIXED_SIGNING_REGIONS[provider.trim().toUpperCase()] ?? normalizedRegion
  return new S3Client({
    endpoint: normalizedEndpoint,
    region: signingRegion,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  })
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const credentialsSchema = z.object({
  endpoint: z.string().min(1),
  region: z.string().optional(),
  provider: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
})

const baseSchema = z.object({
  credentials: credentialsSchema,
  bucket: z.string().min(1),
})

const listObjectsSchema = baseSchema.extend({
  action: z.literal("listObjects"),
  prefix: z.string().default(""),
})

const deleteObjectsSchema = baseSchema.extend({
  action: z.literal("deleteObjects"),
  keys: z.array(z.string().min(1)).min(1),
})

const createFolderSchema = baseSchema.extend({
  action: z.literal("createFolder"),
  folderKey: z.string().min(1),
})

const moveObjectsSchema = baseSchema.extend({
  action: z.literal("moveObjects"),
  ops: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })).min(1),
})

const bodySchema = z.discriminatedUnion("action", [
  listObjectsSchema,
  deleteObjectsSchema,
  createFolderSchema,
  moveObjectsSchema,
])

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleListObjects(
  client: S3Client,
  bucket: string,
  prefix: string
): Promise<{ folders: S3Object[]; files: S3Object[] }> {
  const folders: S3Object[] = []
  const files: S3Object[] = []
  let continuationToken: string | undefined

  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        Delimiter: "/",
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      })
    )

    for (const cp of res.CommonPrefixes ?? []) {
      if (cp.Prefix) {
        folders.push({ key: cp.Prefix, size: 0, lastModified: "", isFolder: true })
      }
    }

    for (const obj of res.Contents ?? []) {
      if (!obj.Key || obj.Key === prefix) continue
      files.push({
        key: obj.Key,
        size: obj.Size ?? 0,
        lastModified: obj.LastModified?.toISOString() ?? "",
        isFolder: false,
      })
    }

    continuationToken = res.NextContinuationToken
  } while (continuationToken)

  return { folders, files }
}

async function handleDeleteObjects(
  client: S3Client,
  bucket: string,
  keys: string[]
): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000)
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((k) => ({ Key: k })), Quiet: true },
      })
    )
  }
}

async function handleCreateFolder(
  client: S3Client,
  bucket: string,
  folderKey: string
): Promise<void> {
  const key = folderKey.endsWith("/") ? folderKey : folderKey + "/"
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: "", ContentLength: 0 })
  )
}

async function handleMoveObjects(
  client: S3Client,
  bucket: string,
  ops: { from: string; to: string }[]
): Promise<void> {
  for (const { from, to } of ops) {
    const copySource = encodeURIComponent(`${bucket}/${from}`)
    await client.send(new CopyObjectCommand({ Bucket: bucket, CopySource: copySource, Key: to }))
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: from }))
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * Server-side proxy for bucket operations.
 *
 * Routes listObjects, deleteObjects, createFolder, and moveObjects through the
 * server so they work regardless of whether the bucket has CORS configured.
 * Credentials are decrypted in the browser before being sent and are never
 * stored here.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 })
    }

    const { credentials, bucket } = parsed.data
    const { endpoint, region, provider, accessKeyId, secretAccessKey } = credentials
    const client = makeClient(endpoint, region ?? "", provider, accessKeyId, secretAccessKey)

    switch (parsed.data.action) {
      case "listObjects": {
        const result = await handleListObjects(client, bucket, parsed.data.prefix)
        return NextResponse.json(result)
      }
      case "deleteObjects": {
        await handleDeleteObjects(client, bucket, parsed.data.keys)
        return NextResponse.json({ ok: true })
      }
      case "createFolder": {
        await handleCreateFolder(client, bucket, parsed.data.folderKey)
        return NextResponse.json({ ok: true })
      }
      case "moveObjects": {
        await handleMoveObjects(client, bucket, parsed.data.ops)
        return NextResponse.json({ ok: true })
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Operation failed" },
      { status: 500 }
    )
  }
}
