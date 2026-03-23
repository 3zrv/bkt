import { describe, it, expect, beforeAll } from "vitest"

// Set env vars before importing crypto module
beforeAll(() => {
  process.env.ENCRYPTION_MASTER_KEY = "a".repeat(64)
  process.env.ENCRYPTION_SALT = "b".repeat(32)
})

describe("crypto", () => {
  it("encrypts and decrypts a string", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto")
    const plaintext = "my-secret-access-key-12345"
    const { ciphertext, iv } = encrypt(plaintext)

    expect(ciphertext).not.toBe(plaintext)
    expect(ciphertext).toContain(":") // ciphertext:authTag format
    expect(iv).toBeTruthy()

    const decrypted = decrypt(ciphertext, iv)
    expect(decrypted).toBe(plaintext)
  })

  it("produces different ciphertext for same plaintext (random IV)", async () => {
    const { encrypt } = await import("@/lib/crypto")
    const plaintext = "same-value"
    const a = encrypt(plaintext)
    const b = encrypt(plaintext)

    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(a.iv).not.toBe(b.iv)
  })

  it("fails to decrypt with wrong IV", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto")
    const { ciphertext } = encrypt("test-value")
    const wrongIv = "00".repeat(16)

    expect(() => decrypt(ciphertext, wrongIv)).toThrow()
  })

  it("handles empty string", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto")
    const { ciphertext, iv } = encrypt("")
    expect(decrypt(ciphertext, iv)).toBe("")
  })

  it("handles unicode", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto")
    const plaintext = "こんにちは世界 🌍"
    const { ciphertext, iv } = encrypt(plaintext)
    expect(decrypt(ciphertext, iv)).toBe(plaintext)
  })
})
