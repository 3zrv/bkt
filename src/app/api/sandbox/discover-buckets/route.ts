import { NextRequest, NextResponse } from "next/server"
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3"
import { z } from "zod"

const schema = z.object({
  endpoint: z.string().min(1),
  region: z.string().optional(),
  provider: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
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
 * Server-side proxy for S3 ListBuckets.
 *
 * Browsers can't call ListBuckets directly because providers don't configure
 * service-level CORS. This route makes the call from the server and returns
 * the bucket names. Credentials are decrypted in the browser before being
 * sent and are never stored here.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 })
    }

    const { endpoint, region, provider, accessKeyId, secretAccessKey } = parsed.data
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

    const result = await client.send(new ListBucketsCommand({}))
    const buckets = (result.Buckets ?? [])
      .map((b) => b.Name)
      .filter((n): n is string => Boolean(n))

    return NextResponse.json({ buckets })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list buckets" },
      { status: 500 }
    )
  }
}
