"use client"

import { useState, useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { RefreshCw, Upload, FolderPlus, ChevronRight, Home } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FileBrowser } from "@/components/dashboard/file-browser"
import { UploadDialog } from "@/components/dashboard/upload-dialog"
import { DeleteConfirmDialog } from "@/components/dashboard/delete-confirm-dialog"
import { RenameDialog } from "@/components/dashboard/rename-dialog"
import { NewFolderDialog } from "@/components/dashboard/new-folder-dialog"
import { FilePreviewDialog } from "@/components/dashboard/file-preview-dialog"
import { formatSize } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { S3Object } from "@/types"

interface BucketOption {
  name: string
  credentialId: string
  credentialLabel: string
}

export interface PaneDropTarget {
  bucket: string
  credentialId: string
  prefix: string
}

interface CommanderPaneProps {
  isActive: boolean
  onActivate: () => void
  buckets: BucketOption[]
  bucketsLoading: boolean
  onFilesDropped?: (files: { key: string; isFolder: boolean }[], target: PaneDropTarget) => void
  paneId: string
}

export function CommanderPane({ isActive, onActivate, buckets, bucketsLoading, onFilesDropped, paneId }: CommanderPaneProps) {
  const queryClient = useQueryClient()

  const [selectedBucketKey, setSelectedBucketKey] = useState<string>("")
  const [dragOver, setDragOver] = useState(false)
  const [prefix, setPrefix] = useState("")
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [uploadOpen, setUploadOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<S3Object | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ key: string; isFolder: boolean } | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [previewFile, setPreviewFile] = useState<S3Object | null>(null)
  const [syncing, setSyncing] = useState(false)

  const selectedBucket = buckets.find((b) => `${b.credentialId}::${b.name}` === selectedBucketKey)
  const bucket = selectedBucket?.name ?? ""
  const credentialId = selectedBucket?.credentialId

  const { data, isLoading } = useQuery({
    queryKey: ["objects", bucket, prefix, credentialId],
    queryFn: async () => {
      if (!bucket) return { folders: [], files: [] }
      const params = new URLSearchParams({ bucket })
      if (prefix) params.set("prefix", prefix)
      if (credentialId) params.set("credentialId", credentialId)
      const res = await fetch(`/api/s3/objects?${params}`)
      if (!res.ok) throw new Error("Failed to load objects")
      return res.json() as Promise<{ folders: S3Object[]; files: S3Object[] }>
    },
    enabled: !!bucket,
  })

  const files: S3Object[] = [
    ...(data?.folders ?? []),
    ...(data?.files ?? []),
  ]

  const totalSize = (data?.files ?? []).reduce((sum, f) => sum + (f.size ?? 0), 0)
  const fileCount = data?.files?.length ?? 0
  const folderCount = data?.folders?.length ?? 0

  const navigate = useCallback((file: S3Object) => {
    if (file.isFolder) {
      setPrefix(file.key)
      setSelectedKeys(new Set())
    }
  }, [])

  const handleDownload = useCallback(async (file: S3Object) => {
    if (!bucket || !credentialId) return
    const params = new URLSearchParams({ bucket, key: file.key })
    if (credentialId) params.set("credentialId", credentialId)
    const res = await fetch(`/api/s3/download?${params}`)
    if (!res.ok) { toast.error("Download failed"); return }
    const { url } = await res.json()
    window.open(url, "_blank")
  }, [bucket, credentialId])

  const handleSync = useCallback(async () => {
    if (!bucket || !credentialId) return
    setSyncing(true)
    try {
      const res = await fetch("/api/s3/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket, credentialId }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(`Synced ${data.synced} files`)
        queryClient.invalidateQueries({ queryKey: ["objects", bucket] })
      } else {
        toast.error(data.error || "Sync failed")
      }
    } catch { toast.error("Sync failed") }
    finally { setSyncing(false) }
  }, [bucket, credentialId, queryClient])

  const handleSelect = useCallback((file: S3Object) => {
    setSelectedKeys((prev) => {
      const key = file.key
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
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

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const source = e.dataTransfer.types.includes("application/x-commander-files")
    if (!source || !bucket || !credentialId) return
    // Don't accept drops from the same pane
    try {
      const raw = e.dataTransfer.getData("text/plain")
      if (raw === paneId) return
    } catch { /* getData fails during dragover in some browsers */ }
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
    setDragOver(true)
  }, [bucket, credentialId, paneId])

  const handleDragLeave = useCallback(() => {
    setDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (!bucket || !credentialId || !onFilesDropped) return
    try {
      const raw = e.dataTransfer.getData("application/x-commander-files")
      if (!raw) return
      const data = JSON.parse(raw) as { sourcePaneId: string; files: { key: string; isFolder: boolean }[] }
      if (data.sourcePaneId === paneId) return
      onFilesDropped(data.files, { bucket, credentialId, prefix })
    } catch { /* ignore parse errors */ }
  }, [bucket, credentialId, prefix, paneId, onFilesDropped])

  const breadcrumbParts = prefix.replace(/\/$/, "").split("/").filter(Boolean)

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden border rounded-md transition-colors",
        isActive ? "border-primary/50 ring-1 ring-primary/20" : "border-border",
        dragOver && "border-primary ring-2 ring-primary/40 bg-primary/5"
      )}
      onClick={onActivate}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Pane header: bucket selector + actions */}
      <div className="flex items-center gap-1 border-b bg-muted/30 px-2 py-1">
        <Select value={selectedBucketKey} onValueChange={(v) => { setSelectedBucketKey(v); setPrefix(""); setSelectedKeys(new Set()) }}>
          <SelectTrigger className="h-7 w-auto min-w-[140px] max-w-[200px] text-xs">
            <SelectValue placeholder="Select bucket" />
          </SelectTrigger>
          <SelectContent>
            {buckets.map((b) => (
              <SelectItem key={`${b.credentialId}::${b.name}`} value={`${b.credentialId}::${b.name}`}>
                {b.name}
              </SelectItem>
            ))}
            {bucketsLoading && <SelectItem value="__loading" disabled>Loading...</SelectItem>}
          </SelectContent>
        </Select>

        <div className="flex-1" />

        {bucket && (
          <>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setUploadOpen(true)} title="Upload">
              <Upload className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setNewFolderOpen(true)} title="New folder">
              <FolderPlus className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleSync} disabled={syncing} title="Sync">
              <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
            </Button>
          </>
        )}
      </div>

      {/* Breadcrumb */}
      {bucket && (
        <div className="flex items-center gap-0.5 border-b bg-muted/10 px-2 py-0.5 text-xs text-muted-foreground">
          <button onClick={() => { setPrefix(""); setSelectedKeys(new Set()) }} className="hover:text-foreground">
            <Home className="h-3 w-3" />
          </button>
          <ChevronRight className="h-3 w-3" />
          <button onClick={() => { setPrefix(""); setSelectedKeys(new Set()) }} className="hover:text-foreground truncate">
            {bucket}
          </button>
          {breadcrumbParts.map((part, i) => {
            const partPath = breadcrumbParts.slice(0, i + 1).join("/") + "/"
            return (
              <span key={partPath} className="flex items-center gap-0.5">
                <ChevronRight className="h-3 w-3" />
                <button onClick={() => { setPrefix(partPath); setSelectedKeys(new Set()) }} className="hover:text-foreground truncate max-w-[100px]">
                  {part}
                </button>
              </span>
            )
          })}
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-auto">
        {!bucket ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a bucket
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
            onRename={(f) => setRenameTarget({ key: f.key, isFolder: f.isFolder })}
            onDelete={(f) => setDeleteTarget(f)}
            onDownload={handleDownload}
            onPreview={(f) => setPreviewFile(f)}
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
          {selectedKeys.size > 0 && (
            <span>{selectedKeys.size} selected</span>
          )}
        </div>
      )}

      {/* Dialogs */}
      {bucket && credentialId && (
        <>
          <UploadDialog
            open={uploadOpen}
            onOpenChange={setUploadOpen}
            bucket={bucket}
            credentialId={credentialId}
            prefix={prefix}
            onUploadComplete={() => {
              queryClient.invalidateQueries({ queryKey: ["objects", bucket] })
            }}
          />
          <DeleteConfirmDialog
            open={!!deleteTarget}
            onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
            bucket={bucket}
            credentialId={credentialId}
            items={deleteTarget ? [deleteTarget] : []}
            onDeleteComplete={() => {
              setDeleteTarget(null)
              queryClient.invalidateQueries({ queryKey: ["objects", bucket] })
            }}
          />
          <RenameDialog
            open={!!renameTarget}
            onOpenChange={(open) => { if (!open) setRenameTarget(null) }}
            bucket={bucket}
            credentialId={credentialId}
            currentKey={renameTarget?.key ?? ""}
            isFolder={renameTarget?.isFolder ?? false}
            onRenameComplete={() => {
              setRenameTarget(null)
              queryClient.invalidateQueries({ queryKey: ["objects", bucket] })
            }}
          />
          <NewFolderDialog
            open={newFolderOpen}
            onOpenChange={setNewFolderOpen}
            bucket={bucket}
            credentialId={credentialId}
            prefix={prefix}
            onCreateComplete={() => {
              setNewFolderOpen(false)
              queryClient.invalidateQueries({ queryKey: ["objects", bucket] })
            }}
          />
          {previewFile && (
            <FilePreviewDialog
              open={!!previewFile}
              onOpenChange={(open) => { if (!open) setPreviewFile(null) }}
              bucket={bucket}
              credentialId={credentialId}
              fileKey={previewFile.key}
              fileName={previewFile.key.split("/").pop() ?? previewFile.key}
              fileSize={previewFile.size}
              onDownload={() => handleDownload(previewFile)}
            />
          )}
        </>
      )}
    </div>
  )
}
