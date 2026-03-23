import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type PutObjectCommandInput,
  type S3Client,
} from "@aws-sdk/client-s3"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { getS3Client } from "@/lib/s3"
import { rebuildUserExtensionStats } from "@/lib/file-stats"
import { buildFileSearchSqlWhereClause, parseScopes } from "@/lib/file-search"
import { getTaskMissedScheduleGraceSeconds } from "@/lib/task-engine-config"
import { nextRunAtForTaskSchedule, resolveTaskSchedule } from "@/lib/task-schedule"
import { isDestinationUpToDateForSync } from "@/lib/transfer-delta"

const USER_ID = "local"
const CHUNK_SIZE = 500
const TRANSFER_CHUNK_SIZE = 50
const LOCK_SECONDS = 45
const SYNC_POLL_INTERVAL_SECONDS = 60
const MAX_RETRY_ATTEMPTS = 5
const TIME_BUDGET_MS = 20_000

// ── Types ──────────────────────────────────────────────────────

interface BulkDeletePayload {
  query: string
  selectedType: string
  selectedCredentialIds: string[]
  selectedBucketScopes: string[]
}

interface BulkDeleteProgress {
  total: number
  deleted: number
  remaining: number
  cursorId: string | null
}

interface TransferPayload {
  scope: "folder" | "bucket"
  operation: "sync" | "copy" | "move" | "migrate"
  sourceCredentialId: string
  sourceBucket: string
  sourcePrefix: string | null
  destinationCredentialId: string
  destinationBucket: string
  destinationPrefix: string | null
  pollIntervalSeconds: number | null
}

interface TransferProgress {
  phase: "transfer"
  total: number
  processed: number
  copied: number
  moved: number
  deleted: number
  skipped: number
  failed: number
  remaining: number
  cursorKey: string | null
}

interface CountRow {
  total: bigint
}

export interface ProcessResult {
  processed: boolean
  taskId?: string
  done?: boolean
  error?: string
}

// ── Payload/Progress Parsers ───────────────────────────────────

function parseBulkDeletePayload(raw: unknown): BulkDeletePayload | null {
  if (!raw || typeof raw !== "object") return null
  const p = raw as Record<string, unknown>
  if (typeof p.query !== "string" || p.query.trim().length < 2) return null
  return {
    query: (p.query as string).trim(),
    selectedType: typeof p.selectedType === "string" ? p.selectedType : "all",
    selectedCredentialIds: Array.isArray(p.selectedCredentialIds)
      ? p.selectedCredentialIds.filter((v): v is string => typeof v === "string")
      : [],
    selectedBucketScopes: Array.isArray(p.selectedBucketScopes)
      ? p.selectedBucketScopes.filter((v): v is string => typeof v === "string")
      : [],
  }
}

function parseBulkDeleteProgress(raw: unknown, totalFallback = 0): BulkDeleteProgress {
  if (!raw || typeof raw !== "object") return { total: totalFallback, deleted: 0, remaining: totalFallback, cursorId: null }
  const p = raw as Record<string, unknown>
  const total = typeof p.total === "number" ? Math.max(0, Math.floor(p.total)) : totalFallback
  const deleted = typeof p.deleted === "number" ? Math.max(0, Math.floor(p.deleted)) : 0
  const remaining = typeof p.remaining === "number" ? Math.max(0, Math.floor(p.remaining)) : Math.max(0, total - deleted)
  return { total, deleted, remaining, cursorId: typeof p.cursorId === "string" && p.cursorId.trim() ? p.cursorId : null }
}

function parseTransferPayload(raw: unknown): TransferPayload | null {
  if (!raw || typeof raw !== "object") return null
  const p = raw as Record<string, unknown>
  const scope = p.scope
  const operation = p.operation
  if (scope !== "folder" && scope !== "bucket") return null
  if (operation !== "sync" && operation !== "copy" && operation !== "move" && operation !== "migrate") return null
  if (typeof p.sourceCredentialId !== "string" || !p.sourceCredentialId.trim()) return null
  if (typeof p.sourceBucket !== "string" || !p.sourceBucket.trim()) return null
  if (typeof p.destinationCredentialId !== "string" || !p.destinationCredentialId.trim()) return null
  if (typeof p.destinationBucket !== "string" || !p.destinationBucket.trim()) return null
  const sourcePrefix = p.sourcePrefix === null ? null : typeof p.sourcePrefix === "string" ? p.sourcePrefix : null
  const destinationPrefix = p.destinationPrefix === null ? null : typeof p.destinationPrefix === "string" ? p.destinationPrefix : null
  if (scope === "folder" && (!sourcePrefix || !destinationPrefix)) return null
  return {
    scope, operation,
    sourceCredentialId: (p.sourceCredentialId as string).trim(),
    sourceBucket: (p.sourceBucket as string).trim(),
    sourcePrefix,
    destinationCredentialId: (p.destinationCredentialId as string).trim(),
    destinationBucket: (p.destinationBucket as string).trim(),
    destinationPrefix,
    pollIntervalSeconds: typeof p.pollIntervalSeconds === "number" && p.pollIntervalSeconds >= SYNC_POLL_INTERVAL_SECONDS
      ? Math.floor(p.pollIntervalSeconds) : null,
  }
}

function parseTransferProgress(raw: unknown, totalFallback = 0): TransferProgress {
  if (!raw || typeof raw !== "object") {
    return { phase: "transfer", total: totalFallback, processed: 0, copied: 0, moved: 0, deleted: 0, skipped: 0, failed: 0, remaining: totalFallback, cursorKey: null }
  }
  const p = raw as Record<string, unknown>
  const n = (k: string, def = 0) => typeof p[k] === "number" ? Math.max(0, Math.floor(p[k] as number)) : def
  const total = n("total", totalFallback)
  const processed = n("processed")
  return {
    phase: "transfer", total, processed,
    copied: n("copied"), moved: n("moved"), deleted: n("deleted"),
    skipped: n("skipped"), failed: n("failed"),
    remaining: typeof p.remaining === "number" ? Math.max(0, Math.floor(p.remaining as number)) : Math.max(0, total - processed),
    cursorKey: typeof p.cursorKey === "string" && p.cursorKey ? p.cursorKey : null,
  }
}

// ── S3 Helpers ─────────────────────────────────────────────────

function buildCopySource(bucket: string, key: string): string {
  return `${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`
}

function toContentLength(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value)
  if (typeof value === "bigint") { const n = Number(value); return Number.isSafeInteger(n) && n >= 0 ? n : null }
  if (typeof value === "string" && value.trim()) { const n = parseInt(value, 10); return Number.isFinite(n) && n >= 0 ? n : null }
  return null
}

function getS3ErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return ""
  const e = error as Record<string, unknown>
  if (typeof e.Code === "string") return e.Code
  if (typeof e.code === "string") return e.code
  if (typeof e.name === "string") return e.name
  return ""
}

function isS3MissingObject(error: unknown): boolean {
  const code = getS3ErrorCode(error)
  if (["NoSuchKey", "NotFound", "NoSuchObject", "404"].includes(code)) return true
  if (!error || typeof error !== "object") return false
  return (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message && error.message !== "UnknownError") return error.message
  if (!error || typeof error !== "object") return error instanceof Error ? error.message : "Task processing failed"
  const e = error as Record<string, unknown>
  const code = typeof e.Code === "string" ? e.Code : typeof e.code === "string" ? e.code : ""
  const name = typeof e.name === "string" ? e.name : ""
  const msg = typeof e.message === "string" ? e.message : typeof e.Message === "string" ? e.Message : ""
  return [msg, code, name].find(v => v && v !== "UnknownError") ?? "Task processing failed"
}

function mapDestinationKey(payload: TransferPayload, sourceKey: string): string {
  if (payload.scope === "bucket") return sourceKey
  const src = payload.sourcePrefix ?? ""
  const dst = payload.destinationPrefix ?? ""
  return sourceKey.startsWith(src) ? `${dst}${sourceKey.slice(src.length)}` : `${dst}${sourceKey}`
}

async function copyObjectAcross(params: {
  sourceClient: S3Client; destinationClient: S3Client; sameCredential: boolean
  sourceBucket: string; sourceKey: string; destinationBucket: string; destinationKey: string
  expectedContentLength?: unknown
}) {
  if (params.sameCredential) {
    try {
      await params.destinationClient.send(new CopyObjectCommand({
        Bucket: params.destinationBucket,
        CopySource: buildCopySource(params.sourceBucket, params.sourceKey),
        Key: params.destinationKey,
      }))
      return
    } catch { /* fall through to streaming */ }
  }
  const src = await params.sourceClient.send(new GetObjectCommand({ Bucket: params.sourceBucket, Key: params.sourceKey }))
  if (!src.Body) throw new Error(`Missing body for '${params.sourceKey}'`)
  let body = src.Body as PutObjectCommandInput["Body"]
  let contentLength = toContentLength(src.ContentLength) ?? toContentLength(params.expectedContentLength)
  if (contentLength === null) {
    const t = src.Body as { transformToByteArray?: () => Promise<Uint8Array> }
    if (typeof t.transformToByteArray === "function") { const b = await t.transformToByteArray(); body = b; contentLength = b.byteLength }
  }
  const input: PutObjectCommandInput = { Bucket: params.destinationBucket, Key: params.destinationKey, Body: body, ContentType: src.ContentType, CacheControl: src.CacheControl }
  if (contentLength !== null) input.ContentLength = contentLength
  await params.destinationClient.send(new PutObjectCommand(input))
}

async function deleteKeysFromBucket(client: S3Client, bucket: string, keys: string[]): Promise<Set<string>> {
  const deleted = new Set<string>()
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000)
    const res = await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map(Key => ({ Key })), Quiet: false } }))
    const ok = (res.Deleted ?? []).map(d => d.Key).filter((k): k is string => Boolean(k))
    if (ok.length > 0) { ok.forEach(k => deleted.add(k)); continue }
    const fail = new Set((res.Errors ?? []).map(e => e.Key).filter((k): k is string => Boolean(k)))
    batch.forEach(k => { if (!fail.has(k)) deleted.add(k) })
  }
  return deleted
}

async function findSyncDrift(payload: TransferPayload): Promise<{ key: string }[]> {
  if (payload.scope === "bucket") {
    return prisma.$queryRaw<{ key: string }[]>(Prisma.sql`
      SELECT d."key" FROM "FileMetadata" d
      WHERE d."userId" = ${USER_ID} AND d."credentialId" = ${payload.destinationCredentialId}
        AND d."bucket" = ${payload.destinationBucket} AND d."isFolder" = false
        AND NOT EXISTS (
          SELECT 1 FROM "FileMetadata" s
          WHERE s."userId" = ${USER_ID} AND s."credentialId" = ${payload.sourceCredentialId}
            AND s."bucket" = ${payload.sourceBucket} AND s."isFolder" = false AND s."key" = d."key"
        )
      ORDER BY d."key" ASC LIMIT ${TRANSFER_CHUNK_SIZE}
    `)
  }
  const srcPfx = payload.sourcePrefix ?? ""
  const dstPfx = payload.destinationPrefix ?? ""
  const dstLen = dstPfx.length
  const subStart = dstLen + 1
  return prisma.$queryRaw<{ key: string }[]>(Prisma.sql`
    SELECT d."key" FROM "FileMetadata" d
    WHERE d."userId" = ${USER_ID} AND d."credentialId" = ${payload.destinationCredentialId}
      AND d."bucket" = ${payload.destinationBucket} AND d."isFolder" = false
      AND LEFT(d."key", ${dstLen}) = ${dstPfx}
      AND NOT EXISTS (
        SELECT 1 FROM "FileMetadata" s
        WHERE s."userId" = ${USER_ID} AND s."credentialId" = ${payload.sourceCredentialId}
          AND s."bucket" = ${payload.sourceBucket} AND s."isFolder" = false
          AND s."key" = ${srcPfx} || substring(d."key" from ${subStart})
      )
    ORDER BY d."key" ASC LIMIT ${TRANSFER_CHUNK_SIZE}
  `)
}

async function cleanupSyncDrift(payload: TransferPayload, destClient: S3Client): Promise<{ deleted: number; failed: number }> {
  let deleted = 0, failed = 0
  while (true) {
    const rows = await findSyncDrift(payload)
    if (rows.length === 0) break
    const keys = rows.map(r => r.key)
    const ok = await deleteKeysFromBucket(destClient, payload.destinationBucket, keys)
    if (ok.size === 0) { failed += keys.length; break }
    await prisma.fileMetadata.deleteMany({
      where: { userId: USER_ID, credentialId: payload.destinationCredentialId, bucket: payload.destinationBucket, key: { in: Array.from(ok) } },
    })
    deleted += ok.size
    failed += Math.max(0, keys.length - ok.size)
  }
  return { deleted, failed }
}

// ── Task Claim ─────────────────────────────────────────────────

async function claimNextTask(): Promise<{
  id: string; type: string; payload: unknown; progress: unknown
  isRecurring: boolean; scheduleCron: string | null; error: string | null
} | null> {
  const now = new Date()
  const staleGraceMs = getTaskMissedScheduleGraceSeconds() * 1000

  // Skip stale scheduled runs
  for (let i = 0; i < 32; i++) {
    const candidate = await prisma.task.findFirst({
      where: { status: { in: ["pending", "running"] }, nextRunAt: { lte: now } },
      orderBy: { createdAt: "asc" },
    })
    if (!candidate) return null

    const schedule = resolveTaskSchedule({ isRecurring: candidate.isRecurring, scheduleCron: candidate.scheduleCron })
    const isStale = candidate.status === "pending" && schedule.enabled && now.getTime() - candidate.nextRunAt.getTime() > staleGraceMs
    if (!isStale) {
      // Claim it
      const lockUntil = new Date(Date.now() + LOCK_SECONDS * 1000)
      const claimed = await prisma.task.updateMany({
        where: { id: candidate.id, status: { in: ["pending", "running"] }, nextRunAt: { lte: now } },
        data: { status: "running", startedAt: candidate.startedAt ?? now, nextRunAt: lockUntil },
      })
      if (claimed.count === 0) return null
      return candidate
    }
    // Skip stale
    const nextRunAt = nextRunAtForTaskSchedule(schedule, now) ?? new Date(now.getTime() + SYNC_POLL_INTERVAL_SECONDS * 1000)
    await prisma.task.updateMany({
      where: { id: candidate.id, status: "pending", nextRunAt: { lte: now } },
      data: { nextRunAt, error: null },
    })
  }
  return null
}

// ── Database Backup Handler ────────────────────────────────────

async function processBackup(task: { id: string; isRecurring: boolean; scheduleCron: string | null; error: string | null }): Promise<ProcessResult> {
  const schedule = resolveTaskSchedule(task)
  try {
    const { runBackup } = await import("@/lib/backup")
    await runBackup()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const nextRunAt = nextRunAtForTaskSchedule(schedule, new Date()) ?? new Date(Date.now() + 60_000)
    await prisma.task.update({
      where: { id: task.id },
      data: { status: task.isRecurring ? "pending" : "failed", error: msg.slice(0, 500), nextRunAt },
    })
    return { processed: true, taskId: task.id, done: false, error: msg }
  }
  const nextRunAt = nextRunAtForTaskSchedule(schedule, new Date()) ?? new Date()
  await prisma.task.update({
    where: { id: task.id },
    data: { status: "pending", error: null, nextRunAt },
  })
  return { processed: true, taskId: task.id, done: true }
}

// ── Object Transfer Handler ────────────────────────────────────

async function processTransfer(task: {
  id: string; payload: unknown; progress: unknown
  isRecurring: boolean; scheduleCron: string | null; error: string | null
}): Promise<ProcessResult> {
  const transferPayload = parseTransferPayload(task.payload)
  if (!transferPayload) {
    await prisma.task.update({ where: { id: task.id }, data: { status: "failed", error: "Invalid transfer payload", completedAt: new Date(), nextRunAt: new Date() } })
    return { processed: false, error: "Invalid transfer payload" }
  }

  const progress = parseTransferProgress(task.progress)
  const sourceFilter: { startsWith?: string; gt?: string } = {}
  if (transferPayload.scope === "folder" && transferPayload.sourcePrefix) sourceFilter.startsWith = transferPayload.sourcePrefix
  if (progress.cursorKey) sourceFilter.gt = progress.cursorKey

  const sourceBatch = await prisma.fileMetadata.findMany({
    where: { userId: USER_ID, credentialId: transferPayload.sourceCredentialId, bucket: transferPayload.sourceBucket, isFolder: false,
      ...(Object.keys(sourceFilter).length > 0 ? { key: sourceFilter } : {}) },
    orderBy: { key: "asc" }, take: TRANSFER_CHUNK_SIZE,
    select: { id: true, key: true, extension: true, size: true, lastModified: true },
  })

  const schedule = resolveTaskSchedule(task)

  // Transfer complete — handle completion + sync cleanup
  if (sourceBatch.length === 0) {
    const total = progress.total > 0 ? progress.total : progress.processed
    let syncDeleted = 0, syncFailed = 0

    if (transferPayload.operation === "sync") {
      const { client: destClient } = await getS3Client(USER_ID, transferPayload.destinationCredentialId)
      const cleanup = await cleanupSyncDrift(transferPayload, destClient)
      syncDeleted = cleanup.deleted; syncFailed = cleanup.failed
    }
    await rebuildUserExtensionStats(USER_ID)

    const finalProgress = { ...progress, total, deleted: progress.deleted + syncDeleted, failed: progress.failed + syncFailed, remaining: 0 }
    if (schedule.enabled) {
      const nextRunAt = nextRunAtForTaskSchedule(schedule, new Date()) ?? new Date(Date.now() + SYNC_POLL_INTERVAL_SECONDS * 1000)
      await prisma.task.update({ where: { id: task.id }, data: {
        status: "pending", nextRunAt, error: null, completedAt: null,
        progress: { phase: "transfer", total: 0, processed: 0, copied: 0, moved: 0, deleted: 0, skipped: 0, failed: 0, remaining: 0, cursorKey: null } as Prisma.InputJsonObject,
      }})
      return { processed: true, taskId: task.id, done: false }
    }
    const hasFails = finalProgress.failed > 0
    await prisma.task.update({ where: { id: task.id }, data: {
      status: hasFails ? "failed" : "completed", completedAt: new Date(), nextRunAt: new Date(),
      progress: finalProgress as unknown as Prisma.InputJsonObject,
      error: hasFails ? (task.error ?? "One or more objects failed") : null,
    }})
    return { processed: true, taskId: task.id, done: true }
  }

  // Process a batch
  const [{ client: srcClient }, { client: destClient }] = await Promise.all([
    getS3Client(USER_ID, transferPayload.sourceCredentialId),
    getS3Client(USER_ID, transferPayload.destinationCredentialId),
  ])
  const sameCred = transferPayload.sourceCredentialId === transferPayload.destinationCredentialId
  const needsCompare = transferPayload.operation === "copy" || transferPayload.operation === "sync"
  const mapped = sourceBatch.map(f => ({ sourceFile: f, destinationKey: mapDestinationKey(transferPayload, f.key) }))

  let destByKey = new Map<string, { size: bigint; lastModified: Date }>()
  if (needsCompare) {
    const rows = await prisma.fileMetadata.findMany({
      where: { userId: USER_ID, credentialId: transferPayload.destinationCredentialId, bucket: transferPayload.destinationBucket, isFolder: false, key: { in: mapped.map(m => m.destinationKey) } },
      select: { key: true, size: true, lastModified: true },
    })
    destByKey = new Map(rows.map(r => [r.key, { size: r.size, lastModified: r.lastModified }]))
  }

  let copied = 0, moved = 0, deleted = 0, skipped = 0, failed = 0, processed = 0
  let lastCursor = progress.cursorKey
  let lastError: string | null = null
  const batchStart = Date.now()

  for (const { sourceFile, destinationKey } of mapped) {
    if (processed > 0 && Date.now() - batchStart >= TIME_BUDGET_MS) break

    if (sameCred && transferPayload.sourceBucket === transferPayload.destinationBucket && sourceFile.key === destinationKey) {
      skipped++; processed++; lastCursor = sourceFile.key; continue
    }

    let destExisting = needsCompare ? destByKey.get(destinationKey) : undefined
    let destExistsRemotely = false
    if (needsCompare && !destExisting) {
      try {
        const head = await destClient.send(new HeadObjectCommand({ Bucket: transferPayload.destinationBucket, Key: destinationKey }))
        if (head.ContentLength !== undefined) { destExistsRemotely = true }
      } catch (e) { if (!isS3MissingObject(e)) throw e }
    }

    if (transferPayload.operation === "copy" && (destExisting || destExistsRemotely)) {
      skipped++; processed++; lastCursor = sourceFile.key; continue
    }
    if (transferPayload.operation === "sync" && destExisting && isDestinationUpToDateForSync({ size: sourceFile.size, lastModified: sourceFile.lastModified }, destExisting)) {
      skipped++; processed++; lastCursor = sourceFile.key; continue
    }

    try {
      await copyObjectAcross({ sourceClient: srcClient, destinationClient: destClient, sameCredential: sameCred,
        sourceBucket: transferPayload.sourceBucket, sourceKey: sourceFile.key,
        destinationBucket: transferPayload.destinationBucket, destinationKey, expectedContentLength: sourceFile.size })

      await prisma.fileMetadata.upsert({
        where: { credentialId_bucket_key: { credentialId: transferPayload.destinationCredentialId, bucket: transferPayload.destinationBucket, key: destinationKey } },
        create: { userId: USER_ID, credentialId: transferPayload.destinationCredentialId, bucket: transferPayload.destinationBucket, key: destinationKey, extension: sourceFile.extension, size: sourceFile.size, lastModified: sourceFile.lastModified, isFolder: false },
        update: { extension: sourceFile.extension, size: sourceFile.size, lastModified: sourceFile.lastModified },
      })

      if (transferPayload.operation === "move" || transferPayload.operation === "migrate") {
        await srcClient.send(new DeleteObjectCommand({ Bucket: transferPayload.sourceBucket, Key: sourceFile.key }))
        await prisma.fileMetadata.deleteMany({ where: { id: sourceFile.id, userId: USER_ID } })
        moved++; deleted++
      } else {
        copied++
      }
      processed++; lastCursor = sourceFile.key
    } catch (err) {
      const code = getS3ErrorCode(err)
      if (!lastError) lastError = formatError(err)
      if (code === "NoSuchKey") {
        await prisma.fileMetadata.deleteMany({ where: { id: sourceFile.id, userId: USER_ID } })
        skipped++
      } else { failed++ }
      processed++; lastCursor = sourceFile.key
    }
  }

  const total = progress.total > 0 ? progress.total : sourceBatch.length
  const next: TransferProgress = {
    phase: "transfer", total,
    processed: progress.processed + processed, copied: progress.copied + copied,
    moved: progress.moved + moved, deleted: progress.deleted + deleted,
    skipped: progress.skipped + skipped, failed: progress.failed + failed,
    remaining: Math.max(0, total - (progress.processed + processed)), cursorKey: lastCursor,
  }
  await prisma.task.update({ where: { id: task.id }, data: {
    status: "running", nextRunAt: new Date(),
    progress: next as unknown as Prisma.InputJsonObject,
    error: lastError ?? (next.failed > 0 ? (task.error ?? "One or more objects failed") : null),
  }})
  return { processed: true, taskId: task.id, done: false }
}

// ── Bulk Delete Handler ────────────────────────────────────────

async function processBulkDelete(task: {
  id: string; payload: unknown; progress: unknown
  isRecurring: boolean; scheduleCron: string | null; error: string | null
}): Promise<ProcessResult> {
  const payload = parseBulkDeletePayload(task.payload)
  if (!payload) {
    await prisma.task.update({ where: { id: task.id }, data: { status: "failed", error: "Invalid payload", completedAt: new Date(), nextRunAt: new Date() } })
    return { processed: false, error: "Invalid payload" }
  }

  const whereClause = buildFileSearchSqlWhereClause({
    userId: USER_ID, query: payload.query, credentialIds: payload.selectedCredentialIds,
    scopes: parseScopes(payload.selectedBucketScopes), type: payload.selectedType,
  })
  const progress = parseBulkDeleteProgress(task.progress)
  const schedule = resolveTaskSchedule(task)

  const batch = await prisma.$queryRaw<{ id: string; key: string; bucket: string; credentialId: string }[]>(Prisma.sql`
    SELECT fm."id", fm."key", fm."bucket", fm."credentialId" FROM "FileMetadata" fm
    WHERE ${whereClause}
    ${progress.cursorId ? Prisma.sql`AND fm."id" > ${progress.cursorId}` : Prisma.empty}
    ORDER BY fm."id" ASC LIMIT ${CHUNK_SIZE}
  `)

  // No more files — complete
  if (batch.length === 0) {
    await rebuildUserExtensionStats(USER_ID)
    if (schedule.enabled) {
      const nextRunAt = nextRunAtForTaskSchedule(schedule, new Date()) ?? new Date(Date.now() + SYNC_POLL_INTERVAL_SECONDS * 1000)
      await prisma.task.update({ where: { id: task.id }, data: {
        status: "pending", nextRunAt, error: null, completedAt: null,
        progress: { total: 0, deleted: 0, remaining: 0, cursorId: null },
      }})
      return { processed: true, taskId: task.id, done: false }
    }
    await prisma.task.update({ where: { id: task.id }, data: {
      status: "completed", completedAt: new Date(), nextRunAt: new Date(), error: null,
      progress: { total: progress.total, deleted: progress.total, remaining: 0, cursorId: null },
    }})
    return { processed: true, taskId: task.id, done: true }
  }

  // Group by credential+bucket and delete
  const grouped = new Map<string, { bucket: string; credentialId: string; rows: typeof batch }>()
  for (const row of batch) {
    const key = `${row.credentialId}::${row.bucket}`
    const g = grouped.get(key)
    if (g) g.rows.push(row); else grouped.set(key, { bucket: row.bucket, credentialId: row.credentialId, rows: [row] })
  }

  const clients = new Map<string, S3Client>()
  const deletedIds = new Set<string>()
  for (const group of grouped.values()) {
    let client = clients.get(group.credentialId)
    if (!client) { client = (await getS3Client(USER_ID, group.credentialId)).client; clients.set(group.credentialId, client) }
    const ok = await deleteKeysFromBucket(client, group.bucket, group.rows.map(r => r.key))
    for (const row of group.rows) { if (ok.has(row.key)) deletedIds.add(row.id) }
  }
  if (deletedIds.size === 0) throw new Error("No files could be deleted in this batch")

  await prisma.fileMetadata.deleteMany({ where: { id: { in: Array.from(deletedIds) } } })
  await rebuildUserExtensionStats(USER_ID)

  const [remainingResult] = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS "total" FROM "FileMetadata" fm WHERE ${whereClause}
  `)
  const remaining = Number(remainingResult?.total ?? 0)
  const total = progress.total > 0 ? progress.total : remaining + deletedIds.size
  const deleted = Math.max(0, total - remaining)

  // Find cursor
  let lastCursor = progress.cursorId
  let blocked = false
  for (const row of batch) {
    if (!blocked && deletedIds.has(row.id)) lastCursor = row.id; else blocked = true
  }

  if (remaining === 0) {
    if (schedule.enabled) {
      const nextRunAt = nextRunAtForTaskSchedule(schedule, new Date()) ?? new Date(Date.now() + SYNC_POLL_INTERVAL_SECONDS * 1000)
      await prisma.task.update({ where: { id: task.id }, data: {
        status: "pending", nextRunAt, error: null, completedAt: null,
        progress: { total: 0, deleted: 0, remaining: 0, cursorId: null },
      }})
      return { processed: true, taskId: task.id, done: false }
    }
    await prisma.task.update({ where: { id: task.id }, data: {
      status: "completed", completedAt: new Date(), nextRunAt: new Date(), error: null,
      progress: { total, deleted, remaining: 0, cursorId: null },
    }})
    return { processed: true, taskId: task.id, done: true }
  }

  await prisma.task.update({ where: { id: task.id }, data: {
    status: "running", nextRunAt: new Date(), error: null,
    progress: { total, deleted, remaining, cursorId: lastCursor },
  }})
  return { processed: true, taskId: task.id, done: false }
}

// ── Main Entry Point ───────────────────────────────────────────

export async function processOneTask(): Promise<ProcessResult> {
  const task = await claimNextTask()
  if (!task) return { processed: false }

  try {
    switch (task.type) {
      case "database_backup":
        return await processBackup(task)
      case "object_transfer":
        return await processTransfer(task)
      case "bulk_delete":
        return await processBulkDelete(task)
      default:
        await prisma.task.update({ where: { id: task.id }, data: { status: "failed", error: `Unknown task type: ${task.type}` } })
        return { processed: false, error: `Unknown task type: ${task.type}` }
    }
  } catch (error) {
    console.error(`[task-processor] Task ${task.id} failed:`, error)
    const msg = formatError(error)
    try {
      const backoff = Math.min(300, Math.pow(2, 3)) * 1000
      await prisma.task.update({ where: { id: task.id }, data: {
        status: "pending", error: msg.slice(0, 500),
        nextRunAt: new Date(Date.now() + backoff),
      }})
    } catch (updateErr) {
      console.error("[task-processor] Failed to update error state:", updateErr)
    }
    return { processed: true, taskId: task.id, done: false, error: msg }
  }
}
