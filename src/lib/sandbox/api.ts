/**
 * Browser-native S3 API for the sandbox.
 *
 * Replaces every /api/s3/* server route with direct AWS SDK v3 calls that
 * run entirely in the browser. Credentials come from IndexedDB via the
 * sandbox client factory.
 */

import {
  ListBucketsCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  type CORSRule,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { Upload } from "@aws-sdk/lib-storage"
import { getSandboxClient } from "@/lib/sandbox/client"
import type { S3Object } from "@/types"

// ---------------------------------------------------------------------------
// CORS detection
// ---------------------------------------------------------------------------

export function isCorsError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return (
    msg.includes("cors") ||
    msg.includes("network error") ||
    msg.includes("failed to fetch") ||
    msg.includes("load failed") ||
    // AWS SDK wraps CORS errors as TypeError with no message
    (err.name === "TypeError" && msg === "")
  )
}

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

export async function listBuckets(
  credentialId: string
): Promise<{ name: string; credentialId: string; credentialLabel: string }[]> {
  const { client, credential } = await getSandboxClient(credentialId)
  const res = await client.send(new ListBucketsCommand({}))
  return (res.Buckets ?? []).map((b) => ({
    name: b.Name ?? "",
    credentialId,
    credentialLabel: credential.label,
  }))
}

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

export async function listObjects(
  credentialId: string,
  bucket: string,
  prefix: string
): Promise<{ folders: S3Object[]; files: S3Object[] }> {
  const { client } = await getSandboxClient(credentialId)

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
        folders.push({
          key: cp.Prefix,
          size: 0,
          lastModified: "",
          isFolder: true,
        })
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

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteObjects(
  credentialId: string,
  bucket: string,
  keys: string[]
): Promise<void> {
  if (keys.length === 0) return
  const { client } = await getSandboxClient(credentialId)

  // S3 DeleteObjects accepts max 1000 keys per request
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000)
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map((k) => ({ Key: k })),
          Quiet: true,
        },
      })
    )
  }
}

// ---------------------------------------------------------------------------
// Create folder
// ---------------------------------------------------------------------------

export async function createFolder(
  credentialId: string,
  bucket: string,
  prefix: string
): Promise<void> {
  const { client } = await getSandboxClient(credentialId)
  const key = prefix.endsWith("/") ? prefix : prefix + "/"
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: "",
      ContentLength: 0,
    })
  )
}

// ---------------------------------------------------------------------------
// Copy / Move / Rename
// ---------------------------------------------------------------------------

export async function copyObject(
  credentialId: string,
  bucket: string,
  fromKey: string,
  toKey: string
): Promise<void> {
  const { client, endpoint } = await getSandboxClient(credentialId)
  // CopySource must be URL-encoded bucket/key
  const copySource = encodeURIComponent(`${bucket}/${fromKey}`)
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: copySource,
      Key: toKey,
    })
  )
  void endpoint // used implicitly via client
}

export async function moveObjects(
  credentialId: string,
  bucket: string,
  ops: { from: string; to: string }[]
): Promise<void> {
  const { client } = await getSandboxClient(credentialId)

  for (const { from, to } of ops) {
    const copySource = encodeURIComponent(`${bucket}/${from}`)
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: copySource,
        Key: to,
      })
    )
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: from,
      })
    )
  }
}

export async function renameObject(
  credentialId: string,
  bucket: string,
  oldKey: string,
  newKey: string
): Promise<void> {
  return moveObjects(credentialId, bucket, [{ from: oldKey, to: newKey }])
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

export async function getDownloadUrl(
  credentialId: string,
  bucket: string,
  key: string
): Promise<string> {
  const { client } = await getSandboxClient(credentialId)
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: 3600,
  })
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface UploadProgress {
  loaded: number
  total: number
  percentage: number
}

export async function uploadFile(
  credentialId: string,
  bucket: string,
  key: string,
  file: File,
  onProgress?: (progress: UploadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const { client } = await getSandboxClient(credentialId)

  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: file,
      ContentType: file.type || "application/octet-stream",
    },
    // Use 8 MB parts (same ballpark as upload-engine.ts)
    partSize: 8 * 1024 * 1024,
    queueSize: 4,
    leavePartsOnError: false,
  })

  if (onProgress) {
    upload.on("httpUploadProgress", (progress) => {
      const loaded = progress.loaded ?? 0
      const total = progress.total ?? file.size
      onProgress({
        loaded,
        total,
        percentage: total > 0 ? Math.round((loaded / total) * 100) : 0,
      })
    })
  }

  if (signal) {
    signal.addEventListener("abort", () => upload.abort())
  }

  await upload.done()
}

// ---------------------------------------------------------------------------
// CORS auto-configure
// ---------------------------------------------------------------------------

const CORS_RULE_ID = "s3admin-sandbox-browser"

export const CORS_POLICY_SNIPPET = JSON.stringify(
  {
    CORSRules: [
      {
        ID: CORS_RULE_ID,
        AllowedOrigins: ["*"],
        AllowedMethods: ["GET", "HEAD", "PUT", "POST", "DELETE"],
        AllowedHeaders: ["*"],
        ExposeHeaders: ["ETag", "x-amz-request-id", "x-amz-version-id"],
        MaxAgeSeconds: 3600,
      },
    ],
  },
  null,
  2
)

export async function ensureCors(credentialId: string, bucket: string): Promise<void> {
  const { client } = await getSandboxClient(credentialId)

  // Fetch existing CORS config (may not exist)
  let existingRules: CORSRule[] = []
  try {
    const existing = await client.send(new GetBucketCorsCommand({ Bucket: bucket }))
    existingRules = existing.CORSRules ?? []
  } catch {
    // NoSuchCORSConfiguration is expected for new buckets
  }

  // Remove any existing sandbox rule and replace it
  const otherRules = existingRules.filter((r) => r.ID !== CORS_RULE_ID)
  const newRule = {
    ID: CORS_RULE_ID,
    AllowedOrigins: ["*"],
    AllowedMethods: ["GET", "HEAD", "PUT", "POST", "DELETE"] as (
      | "GET"
      | "HEAD"
      | "PUT"
      | "POST"
      | "DELETE"
    )[],
    AllowedHeaders: ["*"],
    ExposeHeaders: ["ETag", "x-amz-request-id", "x-amz-version-id"],
    MaxAgeSeconds: 3600,
  }

  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [...otherRules, newRule],
      },
    })
  )
}
