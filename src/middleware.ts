import { NextResponse, type NextRequest } from "next/server"

// NEXT_PUBLIC_SANDBOX_MODE is baked in at build time via the Dockerfile ARG.
// When set, all routes outside /sandbox are redirected there.
const SANDBOX = process.env.NEXT_PUBLIC_SANDBOX_MODE === "1"

export function middleware(request: NextRequest) {
  if (!SANDBOX) return NextResponse.next()

  const { pathname } = request.nextUrl

  // Allow: landing page, sandbox, sandbox API routes, static assets, health check
  if (
    pathname === "/" ||
    pathname.startsWith("/sandbox") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/sandbox") ||
    pathname.startsWith("/api/health") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/opengraph-image"
  ) {
    return NextResponse.next()
  }

  return NextResponse.redirect(new URL("/sandbox", request.url))
}

export const config = {
  matcher: [
    /*
     * Match all paths except Next.js internals and static files.
     * The allowlist above handles the fine-grained exceptions.
     */
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf)).*)",
  ],
}
