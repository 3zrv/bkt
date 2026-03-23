import { describe, it, expect } from "vitest"
import {
  normalizeExtension,
  getMediaTypeFromExtension,
  isVideoExtension,
  isImageExtension,
  isThumbnailSupportedExtension,
  getPreviewType,
  isPreviewableExtension,
} from "@/lib/media"

describe("normalizeExtension", () => {
  it("lowercases", () => {
    expect(normalizeExtension("JPG")).toBe("jpg")
  })

  it("strips leading dot", () => {
    expect(normalizeExtension(".png")).toBe("png")
  })

  it("trims whitespace", () => {
    expect(normalizeExtension("  gif  ")).toBe("gif")
  })

  it("handles null/undefined", () => {
    expect(normalizeExtension(null)).toBe("")
    expect(normalizeExtension(undefined)).toBe("")
  })
})

describe("getMediaTypeFromExtension", () => {
  it("returns image for image extensions", () => {
    expect(getMediaTypeFromExtension("jpg")).toBe("image")
    expect(getMediaTypeFromExtension("png")).toBe("image")
    expect(getMediaTypeFromExtension("webp")).toBe("image")
    expect(getMediaTypeFromExtension("svg")).toBe("image")
  })

  it("returns video for video extensions", () => {
    expect(getMediaTypeFromExtension("mp4")).toBe("video")
    expect(getMediaTypeFromExtension("webm")).toBe("video")
    expect(getMediaTypeFromExtension("mov")).toBe("video")
  })

  it("returns null for non-media", () => {
    expect(getMediaTypeFromExtension("pdf")).toBe(null)
    expect(getMediaTypeFromExtension("txt")).toBe(null)
    expect(getMediaTypeFromExtension("")).toBe(null)
    expect(getMediaTypeFromExtension(null)).toBe(null)
  })
})

describe("isVideoExtension / isImageExtension", () => {
  it("correctly identifies video", () => {
    expect(isVideoExtension("mp4")).toBe(true)
    expect(isVideoExtension("jpg")).toBe(false)
  })

  it("correctly identifies image", () => {
    expect(isImageExtension("png")).toBe(true)
    expect(isImageExtension("mp4")).toBe(false)
  })
})

describe("isThumbnailSupportedExtension", () => {
  it("supports images except svg", () => {
    expect(isThumbnailSupportedExtension("jpg")).toBe(true)
    expect(isThumbnailSupportedExtension("png")).toBe(true)
    expect(isThumbnailSupportedExtension("svg")).toBe(false)
  })

  it("supports videos", () => {
    expect(isThumbnailSupportedExtension("mp4")).toBe(true)
  })

  it("rejects non-media", () => {
    expect(isThumbnailSupportedExtension("pdf")).toBe(false)
    expect(isThumbnailSupportedExtension(null)).toBe(false)
  })
})

describe("getPreviewType", () => {
  it("returns image for image extensions", () => {
    expect(getPreviewType("jpg")).toBe("image")
  })

  it("returns video for video extensions", () => {
    expect(getPreviewType("mp4")).toBe("video")
  })

  it("returns pdf for pdf", () => {
    expect(getPreviewType("pdf")).toBe("pdf")
  })

  it("returns text for text files", () => {
    expect(getPreviewType("txt")).toBe("text")
    expect(getPreviewType("md")).toBe("text")
  })

  it("returns csv for csv/tsv", () => {
    expect(getPreviewType("csv")).toBe("csv")
    expect(getPreviewType("tsv")).toBe("csv")
  })

  it("returns office for office docs", () => {
    expect(getPreviewType("docx")).toBe("office")
    expect(getPreviewType("xlsx")).toBe("office")
    expect(getPreviewType("pptx")).toBe("office")
  })

  it("returns null for unknown", () => {
    expect(getPreviewType("zip")).toBe(null)
    expect(getPreviewType("")).toBe(null)
    expect(getPreviewType(null)).toBe(null)
  })
})

describe("isPreviewableExtension", () => {
  it("returns true for previewable types", () => {
    expect(isPreviewableExtension("jpg")).toBe(true)
    expect(isPreviewableExtension("pdf")).toBe(true)
    expect(isPreviewableExtension("mp4")).toBe(true)
    expect(isPreviewableExtension("docx")).toBe(true)
  })

  it("returns false for non-previewable", () => {
    expect(isPreviewableExtension("zip")).toBe(false)
    expect(isPreviewableExtension("exe")).toBe(false)
    expect(isPreviewableExtension(null)).toBe(false)
  })
})
