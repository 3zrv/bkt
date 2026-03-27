import { NextRequest, NextResponse } from "next/server"
import {
  S3Client,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  type CORSRule,
} from "@aws-sdk/client-s3"
import { z } from "zod"

const CORS_RULE_ID = "s3admin-sandbox-browser"

const schema = z.object({
  endpoint: z.string().min(1),
  region: z.string().optional(),
  provider: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  bucket: z.string().min(1),
})

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

/**
 * Server-side proxy for PutBucketCors.
 *
 * The browser can't call PutBucketCors on a bucket that has no CORS configured
 * yet (chicken-and-egg). The server has no CORS restrictions, so it can
 * bootstrap the policy. Credentials are decrypted in the browser before
 * being sent and are never stored here.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 })
    }

    const { endpoint, region, provider, accessKeyId, secretAccessKey, bucket } = parsed.data
    const normalizedEndpoint = normalizeEndpoint(endpoint)
    const normalizedRegion = resolveRegion(provider, region)
    const signingRegion =
      FIXED_SIGNING_REGIONS[provider.trim().toUpperCase()] ?? normalizedRegion

    const client = new S3Client({
      endpoint: normalizedEndpoint,
      region: signingRegion,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    })

    // Preserve existing rules, replace only the sandbox rule
    let existingRules: CORSRule[] = []
    try {
      const existing = await client.send(new GetBucketCorsCommand({ Bucket: bucket }))
      existingRules = existing.CORSRules ?? []
    } catch {
      // NoSuchCORSConfiguration is expected for new buckets
    }

    const otherRules = existingRules.filter((r) => r.ID !== CORS_RULE_ID)
    const newRule: CORSRule = {
      ID: CORS_RULE_ID,
      AllowedOrigins: ["*"],
      AllowedMethods: ["GET", "HEAD", "PUT", "POST", "DELETE"],
      AllowedHeaders: ["*"],
      ExposeHeaders: ["ETag", "x-amz-request-id", "x-amz-version-id"],
      MaxAgeSeconds: 3600,
    }

    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: { CORSRules: [...otherRules, newRule] },
      })
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to configure CORS" },
      { status: 500 }
    )
  }
}
