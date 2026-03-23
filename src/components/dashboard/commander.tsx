"use client"

import { useState, useEffect, useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Columns2, Square } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { CommanderPane, type PaneDropTarget } from "@/components/dashboard/commander-pane"

interface BucketOption {
  name: string
  credentialId: string
  credentialLabel: string
}

// Stored per-pane so we can look up source bucket/credential for cross-pane ops
interface PaneRef {
  bucket: string
  credentialId: string
}

export function Commander() {
  const queryClient = useQueryClient()
  const [activePane, setActivePane] = useState<"left" | "right">("left")
  const [splitMode, setSplitMode] = useState(true)

  const { data: buckets = [], isLoading: bucketsLoading } = useQuery<BucketOption[]>({
    queryKey: ["buckets"],
    queryFn: async () => {
      const res = await fetch("/api/s3/buckets?all=true")
      if (!res.ok) return []
      const data = await res.json()
      return data.buckets ?? []
    },
  })

  const handleFilesDropped = useCallback(
    async (droppedFiles: { key: string; isFolder: boolean }[], target: PaneDropTarget) => {
      if (!target.bucket || !target.credentialId) return

      const fileKeys = droppedFiles.filter((f) => !f.isFolder)
      if (fileKeys.length === 0) {
        toast.error("Only files can be copied between panes (not folders)")
        return
      }

      const operations = fileKeys.map((f) => {
        const fileName = f.key.split("/").pop() ?? f.key
        const destKey = target.prefix ? `${target.prefix}${fileName}` : fileName
        return { from: f.key, to: destKey }
      })

      toast.info(`Copying ${operations.length} file(s)...`)

      try {
        const res = await fetch("/api/s3/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bucket: target.bucket,
            credentialId: target.credentialId,
            operations,
          }),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          toast.error(data.error || "Copy failed")
          return
        }

        const result = await res.json()
        toast.success(`Copied ${result.moved ?? operations.length} file(s)`)

        // Refresh both panes
        queryClient.invalidateQueries({ queryKey: ["objects"] })
      } catch {
        toast.error("Copy failed")
      }
    },
    [queryClient]
  )

  // Keyboard: Tab to switch panes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Tab" && !e.ctrlKey && !e.metaKey) {
        const target = e.target as HTMLElement
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return
        e.preventDefault()
        setActivePane((p) => (p === "left" ? "right" : "left"))
      }
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
          <CommanderPane
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
            <CommanderPane
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
