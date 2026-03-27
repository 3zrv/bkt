"use client"

import { useState, useEffect, useCallback } from "react"
import { Columns2, Square } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  SandboxPane,
  type SandboxPaneDropTarget,
} from "@/components/sandbox/sandbox-pane"
import { listBuckets, moveObjects, isCorsError } from "@/lib/sandbox/api"
import type { SandboxCredential } from "@/lib/sandbox/store"

interface BucketOption {
  name: string
  credentialId: string
  credentialLabel: string
}

interface SandboxCommanderProps {
  credentials: SandboxCredential[]
}

export function SandboxCommander({ credentials }: SandboxCommanderProps) {
  const [activePane, setActivePane] = useState<"left" | "right">("left")
  const [splitMode, setSplitMode] = useState(true)
  const [buckets, setBuckets] = useState<BucketOption[]>([])
  const [bucketsLoading, setBucketsLoading] = useState(false)

  useEffect(() => {
    if (credentials.length === 0) return
    setBucketsLoading(true)
    const fetches = credentials.map((cred) =>
      listBuckets(cred.id).catch((err) => {
        if (!isCorsError(err)) {
          toast.error(`Failed to load buckets for "${cred.label}": ${err instanceof Error ? err.message : String(err)}`)
        }
        return [] as BucketOption[]
      })
    )
    Promise.all(fetches)
      .then((results) => setBuckets(results.flat()))
      .finally(() => setBucketsLoading(false))
  }, [credentials])

  const handleFilesDropped = useCallback(
    async (droppedFiles: { key: string; isFolder: boolean }[], target: SandboxPaneDropTarget) => {
      if (!target.bucket || !target.credentialId) return

      const fileKeys = droppedFiles.filter((f) => !f.isFolder)
      if (fileKeys.length === 0) {
        toast.error("Only files can be copied between panes (not folders)")
        return
      }

      const ops = fileKeys.map((f) => {
        const fileName = f.key.split("/").pop() ?? f.key
        const destKey = target.prefix ? `${target.prefix}${fileName}` : fileName
        return { from: f.key, to: destKey }
      })

      toast.info(`Copying ${ops.length} file(s)...`)

      try {
        await moveObjects(target.credentialId, target.bucket, ops)
        toast.success(`Copied ${ops.length} file(s)`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Copy failed")
      }
    },
    []
  )

  // Tab key — switch active pane
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.ctrlKey || e.metaKey) return
      const target = e.target as HTMLElement
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) return
      e.preventDefault()
      setActivePane((p) => (p === "left" ? "right" : "left"))
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  return (
    <div className="flex h-full flex-col">
      {/* Split mode toggle */}
      <div className="flex items-center justify-end border-b bg-muted/20 px-2 py-0.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
          onClick={() => setSplitMode((v) => !v)}
          title={splitMode ? "Single pane" : "Split pane"}
        >
          {splitMode ? <Square className="h-3 w-3" /> : <Columns2 className="h-3 w-3" />}
          {splitMode ? "Single" : "Split"}
        </Button>
      </div>

      {/* Panes */}
      <div className="flex flex-1 gap-1 overflow-hidden p-1">
        <div className={splitMode ? "w-1/2" : "w-full"}>
          <SandboxPane
            paneId="left"
            isActive={activePane === "left"}
            onActivate={() => setActivePane("left")}
            buckets={buckets}
            bucketsLoading={bucketsLoading}
            onFilesDropped={handleFilesDropped}
          />
        </div>
        {splitMode && (
          <div className="w-1/2">
            <SandboxPane
              paneId="right"
              isActive={activePane === "right"}
              onActivate={() => setActivePane("right")}
              buckets={buckets}
              bucketsLoading={bucketsLoading}
              onFilesDropped={handleFilesDropped}
            />
          </div>
        )}
      </div>
    </div>
  )
}
