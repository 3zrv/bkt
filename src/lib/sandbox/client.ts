/**
 * Browser S3 client factory for the sandbox.
 *
 * Mirrors the logic in src/lib/s3.ts (createS3ClientFromConfig + caching),
 * but runs entirely in the browser — credentials are read from IndexedDB and
 * decrypted with the device key. No Prisma, no Node.js.
 */

import { S3Client } from "@aws-sdk/client-s3"
import { getCredential, type SandboxCredential } from "@/lib/sandbox/store"
import { getOrCreateDeviceKey, decryptField } from "@/lib/sandbox/crypto"

// ---------------------------------------------------------------------------
// Pure helpers — copied from src/lib/s3.ts (no Prisma import allowed here)
// ---------------------------------------------------------------------------

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"])

function hasProtocol(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

export function normalizeS3Endpoint(endpoint: string): string {
  const trimmed = endpoint.trim()
  if (!trimmed) throw new Error("Endpoint is required")

  let withProtocol = trimmed
  if (!hasProtocol(withProtocol)) {
    const hostPort = withProtocol.split("/")[0] || withProtocol
    const hostname = hostPort.split(":")[0]?.toLowerCase() || ""
    const protocol = LOCAL_HOSTNAMES.has(hostname) ? "http" : "https"
    withProtocol = `${protocol}://${withProtocol}`
  }

  let parsed: URL
  try {
    parsed = new URL(withProtocol)
  } catch {
    throw new Error("Endpoint must be a valid URL")
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Endpoint protocol must be http or https")
  }

  return parsed.toString().replace(/\/+$/, "")
}

const FIXED_SIGNING_REGION_PROVIDERS: Record<string, string> = {
  STORADERA: "us-east-1",
}

export function normalizeS3Region(provider: string, region: string | null | undefined): string {
  const normalizedRegion = region?.trim() ?? ""
  if (normalizedRegion) return normalizedRegion

  const upper = provider.trim().toUpperCase()
  if (upper === "MINIO" || upper === "GENERIC") return "us-east-1"

  throw new Error("Region is required for this provider")
}

export function getSigningRegion(provider: string, region: string): string {
  const override = FIXED_SIGNING_REGION_PROVIDERS[provider.trim().toUpperCase()]
  return override ?? region
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export interface SandboxClientConfig {
  endpoint: string
  region: string | null | undefined
  provider: string
  accessKeyId: string
  secretAccessKey: string
}

export function createSandboxS3Client(config: SandboxClientConfig): {
  client: S3Client
  endpoint: string
  region: string
} {
  const endpoint = normalizeS3Endpoint(config.endpoint)
  const region = normalizeS3Region(config.provider, config.region)
  const signingRegion = getSigningRegion(config.provider, region)

  const client = new S3Client({
    endpoint,
    region: signingRegion,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  })

  return { client, endpoint, region }
}

// ---------------------------------------------------------------------------
// Cached client (5-min TTL, same as server-side)
// ---------------------------------------------------------------------------

const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000

interface CacheEntry {
  client: S3Client
  endpoint: string
  region: string
  expiry: number
}

const clientCache = new Map<string, CacheEntry>()

export async function getSandboxClient(credentialId: string): Promise<{
  client: S3Client
  credential: SandboxCredential
  endpoint: string
  region: string
}> {
  const now = Date.now()
  const cached = clientCache.get(credentialId)
  if (cached && cached.expiry > now) {
    const credential = await getCredential(credentialId)
    if (!credential) throw new Error("Credential not found")
    return { client: cached.client, credential, endpoint: cached.endpoint, region: cached.region }
  }

  // Evict expired entries
  if (clientCache.size > 20) {
    for (const [key, entry] of clientCache) {
      if (entry.expiry <= now) clientCache.delete(key)
    }
  }

  const credential = await getCredential(credentialId)
  if (!credential) throw new Error("Credential not found")

  const deviceKey = await getOrCreateDeviceKey()
  const accessKeyId = await decryptField(deviceKey, credential.accessKeyEnc, credential.ivAccessKey)
  const secretAccessKey = await decryptField(deviceKey, credential.secretKeyEnc, credential.ivSecretKey)

  const { client, endpoint, region } = createSandboxS3Client({
    endpoint: credential.endpoint,
    region: credential.region,
    provider: credential.provider,
    accessKeyId,
    secretAccessKey,
  })

  clientCache.set(credentialId, { client, endpoint, region, expiry: now + CLIENT_CACHE_TTL_MS })
  return { client, credential, endpoint, region }
}

/** Evict a cached client (e.g. after credential update) */
export function evictSandboxClient(credentialId: string): void {
  clientCache.delete(credentialId)
}
