# Bkt

Open-source, self-hosted S3 file manager for Hetzner, AWS, Cloudflare R2, Storadera, MinIO, and any S3-compatible storage provider. Browse, upload, download, move, and manage files across multiple buckets and providers from a single dashboard.

## Demo

[![Bkt Demo](https://img.youtube.com/vi/e3AeQpp5ZBA/maxresdefault.jpg)](https://www.youtube.com/watch?v=e3AeQpp5ZBA)

## Features

- **File Management** — Browse, upload, download, delete, move, rename files and folders
- **Multi-Provider** — Connect AWS S3, Hetzner Object Storage, Cloudflare R2, Storadera, MinIO, or any S3-compatible endpoint
- **Multi-Bucket** — Manage multiple buckets across multiple credentials from one UI
- **Gallery View** — Visual gallery with image previews and video thumbnail generation
- **Background Tasks** — Copy, move, sync, and migrate files between buckets with progress tracking
- **Bulk Delete** — Search-based bulk deletion with preview and recurring schedules
- **Database Backups** — Automated scheduled backups to S3 via pg_dump
- **Global Search** — Full search across all indexed files and buckets with filters
- **File Previews** — In-browser preview for images, videos, PDFs, DOCX, XLSX
- **Version Management** — View and clean up non-current object versions
- **Dashboard Metrics** — File type breakdown, largest files, duplicates, recent activity
- **Encrypted Credentials** — S3 keys encrypted at rest with AES-256-GCM
- **No Auth Required** — Single-user, self-hosted — no login screens or accounts
- **Sandbox Mode** — Browser-only mode at `/sandbox`: no database, credentials stored encrypted in IndexedDB

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Browser                        │
│  React 19 + TanStack Query + Radix UI + Tailwind│
└──────────────────────┬──────────────────────────┘
                       │ HTTP
┌──────────────────────┴──────────────────────────┐
│               Next.js 16 (App Router)            │
│                                                  │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐  │
│  │ API Routes│  │ Task Runner│  │ Instrumentation│ │
│  │ /api/s3/* │  │ (in-process│  │ (startup hook) │ │
│  │ /api/tasks│  │  interval) │  │               │ │
│  └─────┬─────┘  └─────┬─────┘  └───────────────┘ │
│        │              │                           │
│  ┌─────┴──────────────┴─────┐                    │
│  │      Prisma ORM (v7)      │                    │
│  └─────────────┬─────────────┘                    │
└────────────────┼────────────────────────────────┘
                 │
    ┌────────────┴────────────┐
    │    PostgreSQL 17         │
    │  (metadata, tasks,       │
    │   credentials, stats)    │
    └──────────────────────────┘

    S3-Compatible Storage ←──── AWS SDK v3
    (Hetzner, AWS, R2, etc.)
```

### Key Design Decisions

- **No separate worker process** — Background tasks (transfers, bulk deletes, backups) run in-process via an interval timer started in `instrumentation.ts`. No HTTP callback loop, no message queue.
- **No authentication layer** — Single-user, self-hosted. `auth()` returns a hardcoded local user. All routes are open by design.
- **Metadata index** — Files are synced from S3 into a local PostgreSQL `FileMetadata` table. This powers search, dashboard stats, and folder aggregation without hitting S3 on every page load.
- **S3 client caching** — `S3Client` instances are cached by credential ID with a 5-minute TTL to reuse TCP connections.
- **Encrypted credentials** — S3 access keys are encrypted with AES-256-GCM using `ENCRYPTION_MASTER_KEY` before storage. Decrypted on each use.

### Database Schema

| Model                   | Purpose                                                |
| ----------------------- | ------------------------------------------------------ |
| `User`                  | Single local user (FK target for all data)             |
| `S3Credential`          | Encrypted S3 access keys, endpoint, region, provider   |
| `FileMetadata`          | Synced file index — key, size, lastModified, extension |
| `UserFileExtensionStat` | Aggregated file counts/sizes by extension              |
| `Task`                  | Background tasks — bulk delete, transfer, backup       |
| `Backup`                | Database backup records                                |

### Project Structure

```
src/
├── app/
│   ├── (dashboard)/            # Dashboard pages (file browser, search, tasks, settings)
│   ├── sandbox/                # Browser-only sandbox route (no auth, no DB)
│   ├── api/s3/                 # S3 operations (buckets, objects, sync, upload, download, etc.)
│   ├── api/tasks/              # Task CRUD (create, list, pause/resume, delete)
│   └── api/sandbox/            # Sandbox helpers (discover-buckets proxy)
├── components/
│   ├── dashboard/              # File browser, gallery, sidebar, upload dialog, etc.
│   ├── sandbox/                # Sandbox-specific UI (pane, commander, credential manager, CORS guide)
│   ├── providers/              # Theme, React Query providers
│   └── ui/                     # Radix-based UI primitives (shadcn/ui)
├── lib/
│   ├── auth.ts                 # Hardcoded local user session
│   ├── s3.ts                   # S3 client factory with caching
│   ├── crypto.ts               # AES-256-GCM encryption for credentials
│   ├── task-processor.ts       # Core task execution logic (delete, transfer, backup)
│   ├── task-runner.ts          # In-process interval-based task runner
│   ├── task-schedule.ts        # Cron parsing and next-run calculation
│   ├── upload-engine.ts        # Client-side multipart upload with pause/resume
│   ├── file-search.ts          # SQL-based file search with filters
│   ├── file-stats.ts           # Extension stat aggregation
│   └── sandbox/                # Sandbox library (browser-only)
│       ├── crypto.ts           # Web Crypto device key + AES-256-GCM for IndexedDB credentials
│       ├── store.ts            # IndexedDB credential + preference storage
│       ├── client.ts           # Browser S3 client factory (mirrors src/lib/s3.ts)
│       └── api.ts              # All S3 operations running directly in the browser
├── middleware.ts               # Redirect all traffic to /sandbox when SANDBOX_MODE is set
└── instrumentation.ts          # App startup: ensure local user, start task runner
```

## Sandbox Mode

The `/sandbox` route runs entirely in the browser — no database, no server-side credentials, no setup required.

- S3 credentials are encrypted with AES-256-GCM using a device key stored in your browser (never sent to any server)
- Every S3 operation (list, upload, delete, copy, rename, download) is a direct browser → S3 call
- Bucket discovery is proxied through the Next.js server to avoid service-level CORS restrictions on `ListBuckets`
- STORADERA is not supported in sandbox mode (requires a server proxy)

**Limitations vs the full app:** no file preview, no background tasks, no gallery, no global search, no dashboard metrics.

### Run sandbox-only (no database needed)

```bash
docker compose -f docker-compose.sandbox.yml up -d
# Open http://localhost:3000/sandbox
```

The sandbox compose file builds with `NEXT_PUBLIC_SANDBOX_MODE=1` baked in. The middleware redirects all traffic to `/sandbox` and the app starts without `DATABASE_URL`.

---

## Quick Start

### Docker (recommended)

```bash
git clone https://github.com/3zrv/bkt.git
cd bkt

# Copy env and fill in values
cp .env.example .env

# Generate required secrets
openssl rand -hex 32   # → paste into ENCRYPTION_MASTER_KEY
openssl rand -hex 16   # → paste into ENCRYPTION_SALT

# Start the stack
docker compose --env-file .env -f docker/docker-compose.yml up -d

# Run migrations
docker compose --env-file .env -f docker/docker-compose.yml exec app npx prisma migrate deploy

# Open http://localhost:3000
```

### Local Development

```bash
# Install dependencies
npm install

# Start PostgreSQL (via Docker)
docker compose --env-file .env -f docker/docker-compose.yml up db -d

# Run migrations
npx prisma migrate deploy

# Start dev server
npm run dev

# Open http://localhost:3000
```

## Environment Variables

| Variable                       | Required             | Description                                                          |
| ------------------------------ | -------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`                 | Yes (full mode)      | PostgreSQL connection string                                         |
| `ENCRYPTION_MASTER_KEY`        | Yes (full mode)      | 32-byte hex key for credential encryption                            |
| `ENCRYPTION_SALT`              | Yes (full mode)      | 16-byte hex salt for key derivation                                  |
| `SANDBOX_MODE`                 | No                   | Set to `1` to start without a database (redirects to `/sandbox`)    |
| `NEXT_PUBLIC_SANDBOX_MODE`     | No (build-time)      | Bake sandbox flag into the bundle for middleware routing             |
| `NEXT_PUBLIC_SITE_URL`         | No                   | Public URL (default: `http://localhost:3000`)                        |
| `THUMBNAIL_GENERATION_ENABLED` | No                   | Enable image/video thumbnails (default: `true`)                      |
| `THUMBNAIL_MAX_WIDTH`          | No                   | Max thumbnail width in px (default: `480`)                           |
| `BACKUP_S3_ENDPOINT`           | No                   | S3 endpoint for database backups                                     |
| `BACKUP_S3_ACCESS_KEY`         | No                   | Access key for backup bucket                                         |
| `BACKUP_S3_SECRET_KEY`         | No                   | Secret key for backup bucket                                         |
| `BACKUP_S3_BUCKET`             | No                   | Bucket name for backups                                              |
| `BACKUP_SCHEDULE_CRON`         | No                   | Backup cron schedule (default: `0 */3 * * *`)                        |

## Gallery Mode

The dashboard supports List and Gallery view modes.

- Gallery uses infinite scrolling with recursive listing
- Image and video thumbnails generated as WebP and stored in `.s3-admin-generated-thumbnails/` within each bucket
- No separate S3 bucket needed — thumbnails use the same credentials as your files

## Tech Stack

- **Framework**: Next.js 16 (App Router, React 19)
- **Database**: PostgreSQL 17 via Prisma 7
- **UI**: Radix UI + Tailwind CSS 4 + shadcn/ui
- **S3**: AWS SDK v3 (`@aws-sdk/client-s3`)
- **State**: TanStack React Query
- **Uploads**: Custom multipart engine with pause/resume

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
