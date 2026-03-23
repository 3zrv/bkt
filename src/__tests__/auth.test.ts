import { describe, it, expect } from "vitest"
import { auth } from "@/lib/auth"

describe("auth", () => {
  it("returns local user session", async () => {
    const session = await auth()
    expect(session.user.id).toBe("local")
    expect(session.user.role).toBe("admin")
    expect(session.user.name).toBe("Local User")
    expect(session.user.email).toBe("local@localhost")
  })

  it("returns a valid expires date", async () => {
    const session = await auth()
    const expires = new Date(session.expires)
    expect(expires.getTime()).toBeGreaterThan(Date.now())
  })

  it("always returns the same user id", async () => {
    const a = await auth()
    const b = await auth()
    expect(a.user.id).toBe(b.user.id)
  })
})
