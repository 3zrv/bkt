"use client"

import { useState, useCallback, useEffect, useRef, useId } from "react"
import { RefreshCw, Upload, FolderPlus, ChevronRight, Home, X, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FileBrowser } from "@/components/dashboard/file-browser"
import { CorsGuide } from "@/components/sandbox/cors-guide"
import { cn } from "@/lib/utils"
import { formatSize } from "@/lib/format"
import {
  discoverBuckets,
  listObjects,
  deleteObjects,
  createFolder,
  moveObjects,
  getDownloadUrl,
  uploadFile,
  isCorsError,
  type UploadProgress,
} from "@/lib/sandbox/api"
import type { SandboxCredential } from "@/lib/sandbox/store"
import type { S3Object } from "@/types"

export interface SandboxPaneDropTarget {
  bucket: string
  credentialId: string
  prefix: string
}

interface SandboxPaneProps {
  paneId: string
  isActive: boolean
  onActivate: () => void
  credentials: SandboxCredential[]
  onFilesDropped?: (
    files: { key: string; isFolder: boolean }[],
    target: SandboxPaneDropTarget
  ) => void
}

export function SandboxPane({
  paneId,
  isActive,
  onActivate,
  credentials,
  onFilesDropped,
}: SandboxPaneProps) {
  const uid = useId()

  // Credential + bucket selection
  const [credentialId, setCredentialId] = useState(credentials[0]?.id ?? "")
  const [bucket, setBucket] = useState("")
  const [bucketInput, setBucketInput] = useState("") // for manual entry
  const [discoveredBuckets, setDiscoveredBuckets] = useState<string[]>([])
  const [discovering, setDiscovering] = useState(false)

  // File browsing
  const [prefix, setPrefix] = useState("")
  const [files, setFiles] = useState<S3Object[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [corsError, setCorsError] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

  // Dialogs
  const [deleteTarget, setDeleteTarget] = useState<S3Object | null>(null)
  const [renameTarget, setRenameTarget] = useState<S3Object | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)

  // "select" = show discovered buckets dropdown; "manual" = show text input (default)
  const [bucketMode, setBucketMode] = useState<"select" | "manual">("manual")

  // Auto-discover buckets via server proxy whenever credential changes
  useEffect(() => {
    if (!credentialId) return
    let cancelled = false
    setDiscovering(true)
    setDiscoveredBuckets([])
    setBucketMode("manual")

    discoverBuckets(credentialId)
      .then((names) => {
        if (cancelled) return
        if (names.length > 0) {
          setDiscoveredBuckets(names)
          setBucketMode("select")
        }
      })
      .catch(() => { /* silently stay in manual mode */ })
      .finally(() => { if (!cancelled) setDiscovering(false) })

    return () => { cancelled = true }
  }, [credentialId])

  function handleCredentialChange(id: string) {
    setBucket("")
    setBucketInput("")
    setPrefix("")
    setFiles([])
    setCredentialId(id) // triggers the discovery effect above
  }

  async function handleDiscover() {
    if (!credentialId || discovering) return
    setDiscovering(true)
    try {
      const names = await discoverBuckets(credentialId)
      if (names.length === 0) {
        toast.info("No buckets found for this credential")
      } else {
        setDiscoveredBuckets(names)
        setBucketMode("select")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to discover buckets")
    }
    setDiscovering(false)
  }

  // Load files whenever bucket / prefix changes
  const loadFiles = useCallback(async () => {
    if (!bucket || !credentialId) return
    setIsLoading(true)
    setCorsError(false)
    try {
      const { folders, files: fileList } = await listObjects(credentialId, bucket, prefix)
      setFiles([...folders, ...fileList])
    } catch (err) {
      if (isCorsError(err)) {
        setCorsError(true)
      } else {
        toast.error(err instanceof Error ? err.message : "Failed to load objects")
      }
    }
    setIsLoading(false)
  }, [bucket, credentialId, prefix])

  useEffect(() => {
    void loadFiles()
  }, [loadFiles])

  function applyManualBucket() {
    const name = bucketInput.trim()
    if (!name) return
    setBucket(name)
    setPrefix("")
    setSelectedKeys(new Set())
  }

  const navigate = useCallback((file: S3Object) => {
    if (file.isFolder) {
      setPrefix(file.key)
      setSelectedKeys(new Set())
    }
  }, [])

  const handleDownload = useCallback(
    async (file: S3Object) => {
      if (!bucket || !credentialId) return
      try {
        const url = await getDownloadUrl(credentialId, bucket, file.key)
        window.open(url, "_blank")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Download failed")
      }
    },
    [bucket, credentialId]
  )

  const handleSelect = useCallback((file: S3Object) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(file.key)) next.delete(file.key)
      else next.add(file.key)
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    if (selectedKeys.size === files.length) {
      setSelectedKeys(new Set())
    } else {
      setSelectedKeys(new Set(files.map((f) => f.key)))
    }
  }, [files, selectedKeys.size])

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("application/x-commander-files")) return
      if (!bucket || !credentialId) return
      try {
        const raw = e.dataTransfer.getData("text/plain")
        if (raw === paneId) return
      } catch {
        /* getData fails during dragover in some browsers */
      }
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
      setDragOver(true)
    },
    [bucket, credentialId, paneId]
  )

  const handleDragLeave = useCallback(() => setDragOver(false), [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      if (!bucket || !credentialId || !onFilesDropped) return
      try {
        const raw = e.dataTransfer.getData("application/x-commander-files")
        if (!raw) return
        const data = JSON.parse(raw) as {
          sourcePaneId: string
          files: { key: string; isFolder: boolean }[]
        }
        if (data.sourcePaneId === paneId) return
        onFilesDropped(data.files, { bucket, credentialId, prefix })
      } catch {
        /* ignore parse errors */
      }
    },
    [bucket, credentialId, prefix, paneId, onFilesDropped]
  )

  const breadcrumbParts = prefix.replace(/\/$/, "").split("/").filter(Boolean)
  const totalSize = files.filter((f) => !f.isFolder).reduce((s, f) => s + (f.size ?? 0), 0)
  const fileCount = files.filter((f) => !f.isFolder).length
  const folderCount = files.filter((f) => f.isFolder).length

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-md border transition-colors",
        isActive ? "border-primary/50 ring-1 ring-primary/20" : "border-border",
        dragOver && "border-primary ring-2 ring-primary/40 bg-primary/5"
      )}
      onClick={onActivate}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex flex-col gap-1 border-b bg-muted/30 px-2 py-1">
        {/* Row 1: credential selector + action buttons */}
        <div className="flex items-center gap-1">
          <Select
            value={credentialId}
            onValueChange={handleCredentialChange}
          >
            <SelectTrigger className="h-7 w-auto min-w-[120px] max-w-[160px] text-xs">
              <SelectValue placeholder="Credential" />
            </SelectTrigger>
            <SelectContent>
              {credentials.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex-1" />

          {bucket && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={(e) => { e.stopPropagation(); setUploadOpen(true) }}
                title="Upload"
              >
                <Upload className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={(e) => { e.stopPropagation(); setNewFolderOpen(true) }}
                title="New folder"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={(e) => { e.stopPropagation(); void loadFiles() }}
                disabled={isLoading}
                title="Refresh"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
              </Button>
            </>
          )}
        </div>

        {/* Row 2: bucket input */}
        {credentialId && (
          <div className="flex items-center gap-1">
            {bucketMode === "select" ? (
              <>
                <Select
                  value={bucket}
                  onValueChange={(v) => { setBucket(v); setPrefix(""); setSelectedKeys(new Set()) }}
                >
                  <SelectTrigger className="h-7 flex-1 text-xs">
                    <SelectValue placeholder="Select bucket" />
                  </SelectTrigger>
                  <SelectContent>
                    {discoveredBuckets.map((name) => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 shrink-0"
                  onClick={(e) => { e.stopPropagation(); setBucketMode("manual") }}
                  title="Enter bucket name manually"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <>
                <Input
                  className="h-7 flex-1 text-xs"
                  placeholder="Bucket name"
                  value={bucketInput}
                  onChange={(e) => setBucketInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); applyManualBucket() } }}
                  onClick={(e) => e.stopPropagation()}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={(e) => { e.stopPropagation(); applyManualBucket() }}
                  disabled={!bucketInput.trim()}
                >
                  Go
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 shrink-0"
                  onClick={(e) => { e.stopPropagation(); void handleDiscover() }}
                  disabled={discovering}
                  title="Discover buckets"
                >
                  <Search className={cn("h-3.5 w-3.5", discovering && "animate-pulse")} />
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Breadcrumb */}
      {bucket && (
        <div className="flex items-center gap-0.5 border-b bg-muted/10 px-2 py-0.5 text-xs text-muted-foreground">
          <button
            onClick={(e) => { e.stopPropagation(); setPrefix(""); setSelectedKeys(new Set()) }}
            className="hover:text-foreground"
          >
            <Home className="h-3 w-3" />
          </button>
          <ChevronRight className="h-3 w-3" />
          <button
            onClick={(e) => { e.stopPropagation(); setPrefix(""); setSelectedKeys(new Set()) }}
            className="hover:text-foreground truncate"
          >
            {bucket}
          </button>
          {breadcrumbParts.map((part, i) => {
            const partPath = breadcrumbParts.slice(0, i + 1).join("/") + "/"
            return (
              <span key={partPath} className="flex items-center gap-0.5">
                <ChevronRight className="h-3 w-3" />
                <button
                  onClick={(e) => { e.stopPropagation(); setPrefix(partPath); setSelectedKeys(new Set()) }}
                  className="hover:text-foreground truncate max-w-[100px]"
                >
                  {part}
                </button>
              </span>
            )
          })}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {!credentialId ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a credential
          </div>
        ) : !bucket ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
            {bucketMode === "select" ? (
              <span>Select a bucket</span>
            ) : (
              <>
                <span>Enter a bucket name above and press Go</span>
                {!discovering && discoveredBuckets.length === 0 && (
                  <span className="text-xs">
                    Can&apos;t find it? Try the{" "}
                    <button
                      className="underline underline-offset-2 hover:text-foreground"
                      onClick={(e) => { e.stopPropagation(); void handleDiscover() }}
                    >
                      discover
                    </button>{" "}
                    button or type the exact name.
                  </span>
                )}
              </>
            )}
          </div>
        ) : corsError ? (
          <div className="p-4">
            <CorsGuide
              credentialId={credentialId}
              bucket={bucket}
              onConfigured={() => { setCorsError(false); void loadFiles() }}
            />
          </div>
        ) : (
          <FileBrowser
            prefix={prefix}
            files={files}
            isLoading={isLoading}
            selectedKeys={selectedKeys}
            onSelect={handleSelect}
            onSelectAll={handleSelectAll}
            onNavigate={navigate}
            onRename={(f) => setRenameTarget(f)}
            onDelete={(f) => setDeleteTarget(f)}
            onDownload={handleDownload}
            compact
            draggablePaneId={paneId}
          />
        )}
      </div>

      {/* Status bar */}
      {bucket && (
        <div className="flex items-center justify-between border-t bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground">
          <span>
            {folderCount > 0 && `${folderCount} folders · `}
            {fileCount} files · {formatSize(totalSize)}
          </span>
          {selectedKeys.size > 0 && <span>{selectedKeys.size} selected</span>}
        </div>
      )}

      {/* Inline dialogs */}
      {bucket && credentialId && (
        <>
          <SandboxDeleteDialog
            open={!!deleteTarget}
            onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
            item={deleteTarget}
            onConfirm={async () => {
              if (!deleteTarget) return
              await deleteObjects(credentialId, bucket, [deleteTarget.key])
              toast.success("Deleted")
              setDeleteTarget(null)
              void loadFiles()
            }}
          />

          <SandboxRenameDialog
            open={!!renameTarget}
            onOpenChange={(open) => { if (!open) setRenameTarget(null) }}
            currentKey={renameTarget?.key ?? ""}
            isFolder={renameTarget?.isFolder ?? false}
            onConfirm={async (newName) => {
              if (!renameTarget) return
              const parts = renameTarget.key.replace(/\/$/, "").split("/")
              const parent = parts.slice(0, -1).join("/")
              const parentPath = parent ? parent + "/" : ""
              const newKey = parentPath + newName + (renameTarget.isFolder ? "/" : "")
              await moveObjects(credentialId, bucket, [{ from: renameTarget.key, to: newKey }])
              toast.success("Renamed")
              setRenameTarget(null)
              void loadFiles()
            }}
          />

          <SandboxNewFolderDialog
            open={newFolderOpen}
            onOpenChange={setNewFolderOpen}
            prefix={prefix}
            uid={uid}
            onConfirm={async (name) => {
              const key = prefix ? `${prefix}${name}/` : `${name}/`
              await createFolder(credentialId, bucket, key)
              toast.success("Folder created")
              setNewFolderOpen(false)
              void loadFiles()
            }}
          />

          <SandboxUploadDialog
            open={uploadOpen}
            onOpenChange={setUploadOpen}
            credentialId={credentialId}
            bucket={bucket}
            prefix={prefix}
            uid={uid}
            onComplete={() => void loadFiles()}
          />
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline dialog components
// ---------------------------------------------------------------------------

function SandboxDeleteDialog({
  open,
  onOpenChange,
  item,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: S3Object | null
  onConfirm: () => Promise<void>
}) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await onConfirm()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed")
    }
    setDeleting(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete item</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Delete <strong className="text-foreground">{item?.key}</strong>?
          {item?.isFolder && " This will delete all objects inside the folder."}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting && <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" />}
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SandboxRenameDialog({
  open,
  onOpenChange,
  currentKey,
  isFolder,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentKey: string
  isFolder: boolean
  onConfirm: (newName: string) => Promise<void>
}) {
  const uid = useId()
  const currentName = currentKey.replace(/\/$/, "").split("/").pop() ?? ""
  const [name, setName] = useState(currentName)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setName(currentKey.replace(/\/$/, "").split("/").pop() ?? "")
  }, [open, currentKey])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name || name === currentName) return
    setSaving(true)
    try {
      await onConfirm(name)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed")
    }
    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {isFolder ? "folder" : "file"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor={`${uid}-rename`}>New name</Label>
            <Input
              id={`${uid}-rename`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name || name === currentName}>
              {saving && <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" />}
              Rename
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SandboxNewFolderDialog({
  open,
  onOpenChange,
  prefix,
  uid,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  prefix: string
  uid: string
  onConfirm: (name: string) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (open) setName("")
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    try {
      await onConfirm(name.trim())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create folder")
    }
    setCreating(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {prefix && <p className="text-xs text-muted-foreground">Inside: {prefix}</p>}
          <div className="space-y-1">
            <Label htmlFor={`${uid}-folder`}>Folder name</Label>
            <Input
              id={`${uid}-folder`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={creating || !name.trim()}>
              {creating && <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SandboxUploadDialog({
  open,
  onOpenChange,
  credentialId,
  bucket,
  prefix,
  uid,
  onComplete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  credentialId: string
  bucket: string
  prefix: string
  uid: string
  onComplete: () => void
}) {
  const [files, setFiles] = useState<File[]>([])
  const [uploads, setUploads] = useState<
    { name: string; progress: UploadProgress | null; done: boolean; error: string | null }[]
  >([])
  const [uploading, setUploading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open) {
      setFiles([])
      setUploads([])
      abortRef.current = null
    }
  }, [open])

  async function handleUpload() {
    if (files.length === 0) return
    setUploading(true)
    abortRef.current = new AbortController()

    setUploads(files.map((f) => ({ name: f.name, progress: null, done: false, error: null })))

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const key = prefix ? `${prefix}${file.name}` : file.name
      try {
        await uploadFile(
          credentialId,
          bucket,
          key,
          file,
          (progress) => {
            setUploads((prev) => {
              const next = [...prev]
              next[i] = { ...next[i], progress }
              return next
            })
          },
          abortRef.current?.signal
        )
        setUploads((prev) => {
          const next = [...prev]
          next[i] = { ...next[i], done: true }
          return next
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed"
        setUploads((prev) => {
          const next = [...prev]
          next[i] = { ...next[i], error: msg }
          return next
        })
        toast.error(`${file.name}: ${msg}`)
      }
    }

    setUploading(false)
    onComplete()
  }

  const allDone = uploads.length > 0 && uploads.every((u) => u.done || u.error)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upload files</DialogTitle>
        </DialogHeader>

        {prefix && <p className="text-xs text-muted-foreground">Uploading to: {prefix}</p>}

        <div className="space-y-3">
          <input
            id={`${uid}-upload-input`}
            type="file"
            multiple
            className="block w-full text-sm file:mr-2 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            disabled={uploading}
          />

          {uploads.length > 0 && (
            <div className="max-h-48 overflow-y-auto space-y-2">
              {uploads.map((u, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate max-w-[280px]">{u.name}</span>
                    <span className="text-muted-foreground">
                      {u.error ? (
                        <span className="text-destructive">Error</span>
                      ) : u.done ? (
                        <span className="text-green-600">Done</span>
                      ) : u.progress ? (
                        `${u.progress.percentage}%`
                      ) : (
                        "Waiting"
                      )}
                    </span>
                  </div>
                  {u.progress && !u.done && (
                    <div className="h-1 w-full overflow-hidden rounded bg-muted">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${u.progress.percentage}%` }}
                      />
                    </div>
                  )}
                  {u.error && <p className="text-xs text-destructive">{u.error}</p>}
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            {uploading ? (
              <Button variant="outline" onClick={() => abortRef.current?.abort()}>
                <X className="mr-1.5 h-4 w-4" />
                Cancel
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  {allDone ? "Close" : "Cancel"}
                </Button>
                {!allDone && (
                  <Button onClick={handleUpload} disabled={files.length === 0}>
                    Upload {files.length > 0 ? `(${files.length})` : ""}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
