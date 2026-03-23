import { describe, it, expect } from "vitest"
import { normalizeS3Endpoint, normalizeS3Region, getSigningRegion } from "@/lib/s3"

describe("normalizeS3Endpoint", () => {
  it("throws for empty string", () => {
    expect(() => normalizeS3Endpoint("")).toThrow("Endpoint is required")
  })

  it("throws for whitespace-only", () => {
    expect(() => normalizeS3Endpoint("   ")).toThrow("Endpoint is required")
  })

  it("adds https for remote hosts", () => {
    expect(normalizeS3Endpoint("fsn1.your-objectstorage.com")).toBe("https://fsn1.your-objectstorage.com")
  })

  it("adds http for localhost", () => {
    expect(normalizeS3Endpoint("localhost:9000")).toBe("http://localhost:9000")
  })

  it("adds http for 127.0.0.1", () => {
    expect(normalizeS3Endpoint("127.0.0.1:9000")).toBe("http://127.0.0.1:9000")
  })

  it("preserves existing https", () => {
    expect(normalizeS3Endpoint("https://s3.amazonaws.com")).toBe("https://s3.amazonaws.com")
  })

  it("preserves existing http", () => {
    expect(normalizeS3Endpoint("http://minio:9000")).toBe("http://minio:9000")
  })

  it("strips trailing slashes", () => {
    expect(normalizeS3Endpoint("https://s3.amazonaws.com/")).toBe("https://s3.amazonaws.com")
    expect(normalizeS3Endpoint("https://s3.amazonaws.com///")).toBe("https://s3.amazonaws.com")
  })

  it("trims whitespace", () => {
    expect(normalizeS3Endpoint("  https://s3.amazonaws.com  ")).toBe("https://s3.amazonaws.com")
  })

  it("throws for invalid URL", () => {
    expect(() => normalizeS3Endpoint("not a url at all ://")).toThrow()
  })
})

describe("normalizeS3Region", () => {
  it("returns provided region if non-empty", () => {
    expect(normalizeS3Region("AWS", "us-east-1")).toBe("us-east-1")
  })

  it("trims region whitespace", () => {
    expect(normalizeS3Region("AWS", "  eu-west-1  ")).toBe("eu-west-1")
  })

  it("defaults to us-east-1 for MinIO", () => {
    expect(normalizeS3Region("MINIO", null)).toBe("us-east-1")
    expect(normalizeS3Region("minio", "")).toBe("us-east-1")
  })

  it("defaults to us-east-1 for GENERIC", () => {
    expect(normalizeS3Region("GENERIC", undefined)).toBe("us-east-1")
  })

  it("throws for other providers with no region", () => {
    expect(() => normalizeS3Region("AWS", null)).toThrow("Region is required")
    expect(() => normalizeS3Region("HETZNER", "")).toThrow("Region is required")
  })
})

describe("getSigningRegion", () => {
  it("returns override for STORADERA", () => {
    expect(getSigningRegion("STORADERA", "eu-central-1")).toBe("us-east-1")
    expect(getSigningRegion("storadera", "any-region")).toBe("us-east-1")
  })

  it("returns original region for other providers", () => {
    expect(getSigningRegion("AWS", "us-west-2")).toBe("us-west-2")
    expect(getSigningRegion("HETZNER", "fsn1")).toBe("fsn1")
  })
})
