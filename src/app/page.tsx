import Link from "next/link";
import {
  FolderOpen,
  Upload,
  Search,
  Shield,
  Layout,
  Image,
  ArrowRight,
  Github,
  Server,
  Globe,
  Zap,
  Database,
  Copy,
  MonitorSmartphone,
} from "lucide-react";
import { SITE_NAME, DEFAULT_SITE_DESCRIPTION, GITHUB_URL } from "@/lib/seo";
import { absoluteUrl } from "@/lib/site-url";

export default function HomePage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Any",
    description: DEFAULT_SITE_DESCRIPTION,
    url: absoluteUrl("/"),
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    license: "https://www.gnu.org/licenses/agpl-3.0.html",
    isAccessibleForFree: true,
    screenshot: absoluteUrl("/og-image.png"),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="flex min-h-screen flex-col bg-background text-foreground">
        {/* Nav */}
        <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
          <nav className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
            <Link href="/" className="text-lg font-bold tracking-tight">
              {SITE_NAME}
            </Link>
            <div className="flex items-center gap-3">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Github className="h-4 w-4" />
                <span className="hidden sm:inline">GitHub</span>
              </a>
              <Link
                href="/sandbox"
                className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Try Sandbox
              </Link>
            </div>
          </nav>
        </header>

        <main>
          {/* Hero */}
          <section className="relative overflow-hidden border-b">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5" />
            <div className="relative mx-auto max-w-5xl px-4 py-20 sm:py-28">
              <div className="flex flex-col items-center text-center">
                <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
                  <Globe className="h-3 w-3" />
                  Open-source &amp; self-hosted
                </div>
                <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                  S3 file manager that{" "}
                  <span className="text-primary">just works</span>
                </h1>
                <p className="mt-4 max-w-2xl text-lg text-muted-foreground sm:text-xl">
                  Browse, upload, move, and manage files across AWS S3, Hetzner
                  Object Storage, Cloudflare R2, MinIO, and any S3-compatible
                  provider from a single dashboard.
                </p>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                  <Link
                    href="/sandbox"
                    className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Try in Browser
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <a
                    href={GITHUB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 items-center gap-2 rounded-md border bg-background px-5 text-sm font-medium hover:bg-muted transition-colors"
                  >
                    <Github className="h-4 w-4" />
                    Self-host
                  </a>
                </div>
                <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
                  {[
                    "AWS S3",
                    "Hetzner",
                    "Cloudflare R2",
                    "MinIO",
                    "Storadera",
                    "S3-compatible",
                  ].map((name) => (
                    <span key={name} className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary/60" />
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Features */}
          <section className="border-b py-16 sm:py-20">
            <div className="mx-auto max-w-5xl px-4">
              <div className="text-center">
                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  Everything you need to manage S3 storage
                </h2>
                <p className="mt-2 text-muted-foreground">
                  No console. No CLI. One UI for every provider.
                </p>
              </div>
              <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                <FeatureCard
                  icon={Layout}
                  title="Dual-pane file manager"
                  description="Norton Commander-style two-panel browser with drag-and-drop between buckets, breadcrumbs, and keyboard shortcuts."
                />
                <FeatureCard
                  icon={FolderOpen}
                  title="Multi-provider, multi-bucket"
                  description="Connect AWS, Hetzner, Cloudflare R2, Storadera, MinIO, or any S3-compatible endpoint. Manage all buckets from one place."
                />
                <FeatureCard
                  icon={Image}
                  title="Gallery with previews"
                  description="Visual gallery with image previews, video thumbnail generation, and in-browser preview for PDFs, DOCX, and XLSX."
                />
                <FeatureCard
                  icon={Zap}
                  title="Background tasks"
                  description="Copy, move, sync, and migrate files between buckets with progress tracking. Schedule recurring bulk deletes."
                />
                <FeatureCard
                  icon={Search}
                  title="Global search"
                  description="Full search across all indexed files and buckets with extension, size, and date filters."
                />
                <FeatureCard
                  icon={Shield}
                  title="Encrypted credentials"
                  description="S3 access keys encrypted at rest with AES-256-GCM. No plaintext keys stored anywhere."
                />
                <FeatureCard
                  icon={Upload}
                  title="Multipart uploads"
                  description="Upload large files with pause and resume. Progress tracking and automatic retry on failure."
                />
                <FeatureCard
                  icon={Database}
                  title="Database backups"
                  description="Automated PostgreSQL backups to S3 via pg_dump on a configurable cron schedule."
                />
                <FeatureCard
                  icon={Copy}
                  title="Version management"
                  description="View and clean up non-current object versions across buckets. Recover or permanently delete old versions."
                />
              </div>
            </div>
          </section>

          {/* Sandbox vs self-hosted */}
          <section className="border-b py-16 sm:py-20">
            <div className="mx-auto max-w-5xl px-4">
              <div className="text-center">
                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  Two ways to use Bkt
                </h2>
                <p className="mt-2 text-muted-foreground">
                  Start in the browser, graduate to self-hosted when you need
                  more.
                </p>
              </div>
              <div className="mt-12 grid gap-6 sm:grid-cols-2">
                <div className="rounded-lg border p-6">
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                    <MonitorSmartphone className="h-3.5 w-3.5" />
                    Browser-only
                  </div>
                  <h3 className="text-lg font-semibold">Sandbox</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    No install. No database. S3 operations run directly in your
                    browser. Credentials stay in IndexedDB, encrypted with a
                    device key that never leaves your machine.
                  </p>
                  <ul className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <span className="text-primary">+</span> Zero setup
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-primary">+</span> Browse, upload,
                      delete, rename, copy
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-muted-foreground/60">-</span> No
                      file preview or gallery
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-muted-foreground/60">-</span> No
                      background tasks or search
                    </li>
                  </ul>
                  <div className="mt-5">
                    <Link
                      href="/sandbox"
                      className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Open Sandbox
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
                <div className="rounded-lg border p-6">
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                    <Server className="h-3.5 w-3.5" />
                    Self-hosted
                  </div>
                  <h3 className="text-lg font-semibold">Full app</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Docker Compose with PostgreSQL. The full feature set
                    including file previews, gallery, background tasks, global
                    search, and scheduled backups.
                  </p>
                  <ul className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <span className="text-primary">+</span> Everything in
                      sandbox
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-primary">+</span> Gallery, file
                      preview, video thumbnails
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-primary">+</span> Background tasks,
                      search, bulk ops
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-primary">+</span> Database backups
                      to S3
                    </li>
                  </ul>
                  <div className="mt-5">
                    <a
                      href={GITHUB_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-9 items-center gap-2 rounded-md border px-4 text-sm font-medium hover:bg-muted transition-colors"
                    >
                      <Github className="h-3.5 w-3.5" />
                      View on GitHub
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Quick start */}
          <section className="py-16 sm:py-20">
            <div className="mx-auto max-w-5xl px-4 text-center">
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Get started in under a minute
              </h2>
              <div className="mx-auto mt-8 max-w-lg overflow-hidden rounded-lg border bg-card text-left">
                <div className="flex items-center gap-1.5 border-b bg-muted/50 px-4 py-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-green-400/60" />
                  <span className="ml-2 text-xs text-muted-foreground">
                    terminal
                  </span>
                </div>
                <pre className="overflow-x-auto p-4 text-sm leading-relaxed text-muted-foreground">
                  <code>{`git clone ${GITHUB_URL}.git
cd bkt
cp .env.example .env
docker compose up -d`}</code>
                </pre>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                Or try the{" "}
                <Link
                  href="/sandbox"
                  className="text-primary underline underline-offset-2"
                >
                  browser sandbox
                </Link>{" "}
                with zero setup.
              </p>
            </div>
          </section>
        </main>

        {/* Footer */}
        <footer className="border-t py-8">
          <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:flex-row">
            <span>{SITE_NAME} &mdash; Open-source S3 file manager</span>
            <div className="flex items-center gap-4">
              <Link
                href="/sandbox"
                className="hover:text-foreground transition-colors"
              >
                Sandbox
              </Link>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
              >
                GitHub
              </a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border p-5 transition-colors hover:bg-muted/30">
      <Icon className="h-5 w-5 text-primary" />
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
