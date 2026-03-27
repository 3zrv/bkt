"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Copy, Check, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { CORS_POLICY_SNIPPET, ensureCors } from "@/lib/sandbox/api"

interface CorsGuideProps {
  credentialId: string
  bucket: string
  /** Called after a successful auto-configure or manual setup confirmation */
  onConfigured: () => void
}

export function CorsGuide({ credentialId, bucket, onConfigured }: CorsGuideProps) {
  const [copied, setCopied] = useState(false)
  const [configuring, setConfiguring] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(CORS_POLICY_SNIPPET)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleAutoConfigure() {
    setConfiguring(true)
    try {
      await ensureCors(credentialId, bucket)
      toast.success("CORS configured successfully")
      onConfigured()
    } catch (err) {
      if (err instanceof Error && err.message.toLowerCase().includes("access denied")) {
        toast.error("Access denied — your credential lacks s3:PutBucketCors permission. Apply the policy manually.")
      } else {
        toast.error(err instanceof Error ? err.message : "CORS configuration failed")
      }
    }
    setConfiguring(false)
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-amber-50 dark:bg-amber-950/30 p-4 text-sm">
      <div>
        <p className="font-medium text-amber-900 dark:text-amber-200">CORS not configured</p>
        <p className="mt-0.5 text-amber-800 dark:text-amber-300">
          Your browser cannot access <strong>{bucket}</strong> directly until CORS is enabled on the
          bucket.
        </p>
      </div>

      <div className="space-y-2">
        <p className="font-medium text-amber-900 dark:text-amber-200">Option 1 — Auto-configure</p>
        <p className="text-amber-800 dark:text-amber-300">
          If your credential has <code className="rounded bg-amber-100 dark:bg-amber-900 px-1">s3:PutBucketCors</code> permission,
          click below to configure CORS automatically:
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAutoConfigure}
          disabled={configuring}
          className="border-amber-300 dark:border-amber-700"
        >
          {configuring ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          Auto-configure CORS
        </Button>
      </div>

      <div className="space-y-2">
        <p className="font-medium text-amber-900 dark:text-amber-200">Option 2 — Manual setup</p>
        <p className="text-amber-800 dark:text-amber-300">
          Apply the following CORS policy to your bucket via the AWS/provider console or CLI:
        </p>
        <div className="relative">
          <pre className="overflow-x-auto rounded border bg-card p-3 text-xs text-foreground">
            {CORS_POLICY_SNIPPET}
          </pre>
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-1 top-1 h-7 w-7 p-0"
            onClick={handleCopy}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <p className="text-xs text-amber-700 dark:text-amber-400">
          AWS CLI:{" "}
          <code className="rounded bg-amber-100 dark:bg-amber-900 px-1">
            {`aws s3api put-bucket-cors --bucket ${bucket} --cors-configuration file://cors.json`}
          </code>
        </p>
      </div>

      <Button variant="outline" size="sm" onClick={onConfigured} className="self-start border-amber-300 dark:border-amber-700">
        I've configured CORS — retry
      </Button>
    </div>
  )
}
