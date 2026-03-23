import { describe, it, expect } from "vitest"
import { getObjectExtension } from "@/lib/file-stats"

describe("getObjectExtension", () => {
  it("returns empty for folders", () => {
    expect(getObjectExtension("images/", true)).toBe("")
    expect(getObjectExtension("photos/vacation/", true)).toBe("")
  })

  it("extracts extension from simple filename", () => {
    expect(getObjectExtension("photo.jpg", false)).toBe("jpg")
  })

  it("extracts extension from path", () => {
    expect(getObjectExtension("images/photo.png", false)).toBe("png")
  })

  it("extracts extension from deep path", () => {
    expect(getObjectExtension("a/b/c/file.tar.gz", false)).toBe("gz")
  })

  it("lowercases the extension", () => {
    expect(getObjectExtension("FILE.JPG", false)).toBe("jpg")
    expect(getObjectExtension("file.PDF", false)).toBe("pdf")
  })

  it("returns empty for no extension", () => {
    expect(getObjectExtension("Makefile", false)).toBe("")
    expect(getObjectExtension("README", false)).toBe("")
  })

  it("returns empty for dot-only files", () => {
    expect(getObjectExtension(".gitignore", false)).toBe("")
  })

  it("returns empty for trailing dot", () => {
    expect(getObjectExtension("file.", false)).toBe("")
  })

  it("handles keys ending with slash (non-folder)", () => {
    expect(getObjectExtension("file.txt/", false)).toBe("txt")
  })
})
