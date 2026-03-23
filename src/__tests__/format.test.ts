import { describe, it, expect } from "vitest"
import { formatSize, formatDate, formatSpeed, formatEta } from "@/lib/format"

describe("formatSize", () => {
  it("returns zero label for 0 bytes", () => {
    expect(formatSize(0)).toBe("0 B")
  })

  it("returns custom zero label", () => {
    expect(formatSize(0, "—")).toBe("—")
  })

  it("returns zero label for negative", () => {
    expect(formatSize(-100)).toBe("0 B")
  })

  it("returns zero label for NaN", () => {
    expect(formatSize(NaN)).toBe("0 B")
  })

  it("returns zero label for Infinity", () => {
    expect(formatSize(Infinity)).toBe("0 B")
  })

  it("formats bytes", () => {
    expect(formatSize(500)).toBe("500 B")
  })

  it("formats kilobytes", () => {
    expect(formatSize(1024)).toBe("1.0 KB")
    expect(formatSize(1536)).toBe("1.5 KB")
  })

  it("formats megabytes", () => {
    expect(formatSize(1024 * 1024)).toBe("1.0 MB")
    expect(formatSize(5.5 * 1024 * 1024)).toBe("5.5 MB")
  })

  it("formats gigabytes", () => {
    expect(formatSize(1024 * 1024 * 1024)).toBe("1.0 GB")
  })

  it("formats terabytes", () => {
    expect(formatSize(1024 * 1024 * 1024 * 1024)).toBe("1.0 TB")
  })

  it("caps at TB for very large values", () => {
    expect(formatSize(5 * 1024 * 1024 * 1024 * 1024)).toBe("5.0 TB")
  })
})

describe("formatDate", () => {
  it("returns fallback for null", () => {
    expect(formatDate(null)).toBe("—")
  })

  it("returns fallback for undefined", () => {
    expect(formatDate(undefined)).toBe("—")
  })

  it("returns custom fallback", () => {
    expect(formatDate(null, "Never")).toBe("Never")
  })

  it("formats a valid ISO date", () => {
    const result = formatDate("2026-03-23T12:00:00.000Z")
    expect(result).toContain("Mar")
    expect(result).toContain("23")
    expect(result).toContain("2026")
  })
})

describe("formatSpeed", () => {
  it("returns empty for 0", () => {
    expect(formatSpeed(0)).toBe("")
  })

  it("returns empty for negative", () => {
    expect(formatSpeed(-100)).toBe("")
  })

  it("formats bytes per second", () => {
    expect(formatSpeed(500)).toBe("500 B/s")
  })

  it("formats MB per second", () => {
    expect(formatSpeed(5 * 1024 * 1024)).toBe("5.0 MB/s")
  })
})

describe("formatEta", () => {
  it("returns empty for 0 speed", () => {
    expect(formatEta(1000, 0)).toBe("")
  })

  it("returns seconds for short durations", () => {
    expect(formatEta(30, 1)).toBe("30s left")
  })

  it("returns minutes for medium durations", () => {
    expect(formatEta(120, 1)).toBe("2m left")
  })

  it("returns hours and minutes for long durations", () => {
    expect(formatEta(7200, 1)).toBe("2h 0m left")
  })
})
