# Contributing to Bkt

Thank you for considering contributing to Bkt! This document provides guidelines for contributing to the project.

## Getting Started

1. Fork the repository
2. Clone your fork
3. Create a new branch for your feature or fix
4. Make your changes
5. Submit a pull request

## Development Setup

```bash
# Install dependencies
pnpm install

# Copy the environment template and fill in values
cp .env.example .env

# Generate required secrets
openssl rand -hex 32   # → ENCRYPTION_MASTER_KEY
openssl rand -hex 16   # → ENCRYPTION_SALT

# Start PostgreSQL
docker compose up db -d

# Run database migrations
npx prisma migrate deploy

# Start the dev server
pnpm dev
```

The app will be available at `http://localhost:3000`.

## Project Structure

```
src/
├── app/
│   ├── (dashboard)/          # Dashboard pages (commander, overview, search, tasks)
│   ├── api/s3/               # S3 operations (buckets, objects, sync, upload, download)
│   └── api/tasks/            # Background task CRUD
├── components/
│   ├── dashboard/            # Commander, file browser, gallery, toolbar, dialogs
│   ├── providers/            # Theme, React Query providers
│   └── ui/                   # Radix-based UI primitives (shadcn/ui)
├── lib/
│   ├── auth.ts               # Hardcoded local user session (no auth layer)
│   ├── s3.ts                 # S3 client factory with connection caching
│   ├── crypto.ts             # AES-256-GCM encryption for stored credentials
│   ├── task-processor.ts     # Background task execution (delete, transfer, backup)
│   ├── task-runner.ts        # In-process interval-based task runner
│   ├── upload-engine.ts      # Client-side multipart upload with pause/resume
│   └── file-search.ts        # SQL-based file search with filters
├── __tests__/                # Unit tests (Vitest)
├── instrumentation.ts        # App startup: ensure local user, start task runner
prisma/
├── schema.prisma             # Database schema (6 models)
└── migrations/               # SQL migrations
```

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/s3.ts` | S3 client creation, endpoint normalization, credential decryption, client caching |
| `src/lib/task-processor.ts` | Core logic for bulk delete, object transfer, and database backup tasks |
| `src/lib/task-runner.ts` | Polls for due tasks and runs them in-process |
| `src/components/dashboard/commander.tsx` | Dual-pane file manager with drag-and-drop between buckets |
| `src/components/dashboard/commander-pane.tsx` | Single pane: bucket selector, file list, breadcrumbs, status bar |
| `src/components/dashboard/toolbar.tsx` | Top navigation bar with page links and theme toggle |
| `src/components/dashboard/file-browser.tsx` | File table with selection, sorting, context menu, drag support |
| `src/components/dashboard/dashboard-overview.tsx` | Dashboard metrics and stats display |

## Architecture Notes

- **Commander layout** — Dual-pane file manager (Total Commander style). Each pane independently browses a bucket. Drag files between panes to copy.
- **No auth** — Single-user, self-hosted. `auth()` returns a hardcoded local user.
- **No separate worker** — Background tasks run in-process via `setInterval` in `instrumentation.ts`.
- **Metadata index** — Files are synced from S3 into PostgreSQL. Search, stats, and folder views query the index, not S3 directly.
- **S3 client cache** — Clients are cached by credential ID with a 5-minute TTL.
- **Batch sync** — Uses `INSERT ... ON CONFLICT` for bulk upserts during sync.

## Testing

Tests use [Vitest](https://vitest.dev/) and cover core utilities (crypto, S3 normalization, file stats, media types, formatting, task scheduling, auth).

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch
```

When adding new utility functions in `src/lib/`, add corresponding tests in `src/__tests__/`.

## Pull Request Guidelines

- Keep PRs focused on a single change
- Ensure tests pass: `pnpm test`
- Ensure the build passes: `pnpm build`
- Ensure types pass: `npx tsc --noEmit`
- Follow the existing code style

## Reporting Issues

Please use GitHub Issues to report bugs or request features. Include:

- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Environment details (OS, Node.js version, browser)

## License

By contributing, you agree that your contributions will be licensed under the AGPL-3.0 License.
