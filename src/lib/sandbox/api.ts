/**
 * Browser-native S3 API for the sandbox.
 *
 * Read/write bucket operations (list, delete, copy, move) are proxied through
 * the Next.js server at /api/sandbox/proxy so they work regardless of whether
 * the bucket has CORS configured. Only uploads go browser→S3 directly (via
 * the @aws-sdk/lib-storage multipart engine) because streaming large files
 * through the server is impractical.
 */

import { ListBucketsCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { Upload } from "@aws-sdk/lib-storage"
import { getSandboxClient } from "@/lib/sandbox/client"
import { getCredential } from "@/lib/sandbox/store"
import { getOrCreateDeviceKey, decryptField } from "@/lib/sandbox/crypto"
import type { S3Object } from "@/types"

// ---------------------------------------------------------------------------
// Proxy helper — decrypts credentials and calls /api/sandbox/proxy
// ---------------------------------------------------------------------------

type ProxyAction =
  | { action: "listObjects"; prefix: string }
  | { action: "deleteObjects"; keys: string[] }
  | { action: "createFolder"; folderKey: string }
  | { action: "moveObjects"; ops: { from: string; to: string }[] }

async function callProxy<T>(credentialId: string, bucket: string, action: ProxyAction): Promise<T> {
  const credential = await getCredential(credentialId)
  if (!credential) throw new Error("Credential not found")

  const deviceKey = await getOrCreateDeviceKey()
  const accessKeyId = await decryptField(deviceKey, credential.accessKeyEnc, credential.ivAccessKey)
  const secretAccessKey = await decryptField(
    deviceKey,
    credential.secretKeyEnc,
    credential.ivSecretKey
  )

  const res = await fetch("/api/sandbox/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...action,
      bucket,
      credentials: {
        endpoint: credential.endpoint,
        region: credential.region,
        provider: credential.provider,
        accessKeyId,
        secretAccessKey,
      },
    }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? "Operation failed")
  }

  return res.json() as Promise<T>
}

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

/**
 * Discover buckets via the server-side proxy route.
 *
 * Unlike listBuckets(), this decrypts credentials in the browser and sends
 * them to /api/sandbox/discover-buckets. The server makes the ListBuckets
 * call (no browser CORS restrictions). Falls back gracefully when running
 * as a static site (proxy unavailable).
 */
export async function discoverBuckets(credentialId: string): Promise<string[]> {
  const credential = await getCredential(credentialId)
  if (!credential) throw new Error("Credential not found")

  const deviceKey = await getOrCreateDeviceKey()
  const accessKeyId = await decryptField(deviceKey, credential.accessKeyEnc, credential.ivAccessKey)
  const secretAccessKey = await decryptField(
    deviceKey,
    credential.secretKeyEnc,
    credential.ivSecretKey
  )

  const res = await fetch("/api/sandbox/discover-buckets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: credential.endpoint,
      region: credential.region,
      provider: credential.provider,
      accessKeyId,
      secretAccessKey,
    }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? "Failed to discover buckets")
  }

  const { buckets } = (await res.json()) as { buckets: string[] }
  return buckets
}

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

export async function listObjects(
  credentialId: string,
  bucket: string,
  prefix: string
): Promise<{ folders: S3Object[]; files: S3Object[] }> {
  return callProxy(credentialId, bucket, { action: "listObjects", prefix })
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
  await callProxy(credentialId, bucket, { action: "deleteObjects", keys })
}

// ---------------------------------------------------------------------------
// Create folder
// ---------------------------------------------------------------------------

export async function createFolder(
  credentialId: string,
  bucket: string,
  folderKey: string
): Promise<void> {
  await callProxy(credentialId, bucket, { action: "createFolder", folderKey })
}

// ---------------------------------------------------------------------------
// Copy / Move / Rename
// ---------------------------------------------------------------------------

export async function moveObjects(
  credentialId: string,
  bucket: string,
  ops: { from: string; to: string }[]
): Promise<void> {
  await callProxy(credentialId, bucket, { action: "moveObjects", ops })
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
  // Route through the server proxy — the browser can't call PutBucketCors on a
  // bucket that has no CORS configured yet (chicken-and-egg).
  const credential = await getCredential(credentialId)
  if (!credential) throw new Error("Credential not found")

  const deviceKey = await getOrCreateDeviceKey()
  const accessKeyId = await decryptField(deviceKey, credential.accessKeyEnc, credential.ivAccessKey)
  const secretAccessKey = await decryptField(
    deviceKey,
    credential.secretKeyEnc,
    credential.ivSecretKey
  )

  const res = await fetch("/api/sandbox/ensure-cors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: credential.endpoint,
      region: credential.region,
      provider: credential.provider,
      accessKeyId,
      secretAccessKey,
      bucket,
    }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? "Failed to configure CORS")
  }
}
