"use client"

import { useState, useId } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Loader2, Trash2, Star, Plus, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"
import { PROVIDERS, type Provider } from "@/lib/providers"
import {
  saveCredential,
  deleteCredential,
  setDefaultCredential,
  type SandboxCredential,
} from "@/lib/sandbox/store"
import { getOrCreateDeviceKey, encryptField } from "@/lib/sandbox/crypto"
import { evictSandboxClient } from "@/lib/sandbox/client"
import { createSandboxS3Client } from "@/lib/sandbox/client"
import { decryptField } from "@/lib/sandbox/crypto"

// Sandbox supports all providers except STORADERA (requires server proxy)
const SANDBOX_PROVIDERS = Object.entries(PROVIDERS).filter(
  ([key]) => key !== "STORADERA"
) as [Provider, (typeof PROVIDERS)[Provider]][]

const credentialSchema = z
  .object({
    label: z.string().min(1, "Label is required").max(100),
    provider: z.enum(["AWS", "HETZNER", "CLOUDFLARE_R2", "MINIO", "GENERIC"]),
    endpoint: z.string().min(1, "Endpoint is required"),
    region: z.string().optional(),
    accessKey: z.string().min(1, "Access key is required"),
    secretKey: z.string().min(1, "Secret key is required"),
  })
  .superRefine((v, ctx) => {
    if (v.provider !== "MINIO" && v.provider !== "GENERIC" && !v.region) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["region"],
        message: "Region is required for this provider",
      })
    }
  })

interface CredentialManagerProps {
  credentials: SandboxCredential[]
  onCredentialsChange: (creds: SandboxCredential[]) => void
  onClose?: () => void
}

export function CredentialManager({
  credentials,
  onCredentialsChange,
  onClose,
}: CredentialManagerProps) {
  const [addOpen, setAddOpen] = useState(false)

  async function handleDelete(id: string) {
    await deleteCredential(id)
    evictSandboxClient(id)
    onCredentialsChange(credentials.filter((c) => c.id !== id))
    toast.success("Credential removed")
  }

  async function handleSetDefault(id: string) {
    await setDefaultCredential(id)
    onCredentialsChange(credentials.map((c) => ({ ...c, isDefault: c.id === id })))
  }

  function handleAdded(cred: SandboxCredential) {
    const updated = credentials.some((c) => c.id === cred.id)
      ? credentials.map((c) => (c.id === cred.id ? cred : c))
      : [...credentials, cred]
    onCredentialsChange(updated)
    setAddOpen(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">S3 Credentials</h2>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Add
          </Button>
          {onClose && (
            <Button size="sm" variant="outline" onClick={onClose}>
              Done
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-md border bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Credentials are encrypted with a device key stored in your browser. They never leave
          your device. STORADERA requires a server proxy and is not supported here.
        </span>
      </div>

      {credentials.length === 0 ? (
        <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
          No credentials yet. Add one to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {credentials.map((cred) => (
            <div
              key={cred.id}
              className="flex items-center justify-between rounded-md border bg-card px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-sm">{cred.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {PROVIDERS[cred.provider as Provider]?.name ?? cred.provider} · {cred.endpoint}
                </p>
              </div>
              <div className="flex items-center gap-1 ml-2">
                {cred.isDefault && (
                  <span className="text-xs text-muted-foreground mr-1">default</span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => handleSetDefault(cred.id)}
                  title="Set as default"
                  disabled={cred.isDefault}
                >
                  <Star className={cred.isDefault ? "h-3.5 w-3.5 fill-yellow-400 text-yellow-400" : "h-3.5 w-3.5"} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(cred.id)}
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddCredentialDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        isFirst={credentials.length === 0}
        onAdded={handleAdded}
      />
    </div>
  )
}

interface AddCredentialDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isFirst: boolean
  onAdded: (cred: SandboxCredential) => void
}

function AddCredentialDialog({ open, onOpenChange, isFirst, onAdded }: AddCredentialDialogProps) {
  const uid = useId()
  const [provider, setProvider] = useState<string>("AWS")
  const [label, setLabel] = useState("")
  const [endpoint, setEndpoint] = useState("")
  const [region, setRegion] = useState("")
  const [accessKey, setAccessKey] = useState("")
  const [secretKey, setSecretKey] = useState("")
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const providerConfig = PROVIDERS[provider as Provider]

  function handleProviderChange(p: string) {
    setProvider(p)
    const cfg = PROVIDERS[p as Provider]
    if (cfg.defaultRegion) setRegion(cfg.defaultRegion)
    // Auto-fill endpoint if it has no placeholders
    if (cfg.endpoint && !cfg.endpoint.includes("{")) {
      setEndpoint(cfg.endpoint)
    } else if (!cfg.endpoint.includes("{region}") || region) {
      // leave endpoint for user to fill
      setEndpoint("")
    }
  }

  function validate() {
    const result = credentialSchema.safeParse({ label, provider, endpoint, region, accessKey, secretKey })
    if (result.success) {
      setErrors({})
      return true
    }
    const errs: Record<string, string> = {}
    for (const issue of result.error.issues) {
      const field = issue.path[0] as string
      if (!errs[field]) errs[field] = issue.message
    }
    setErrors(errs)
    return false
  }

  async function handleTest() {
    if (!validate()) return
    setTesting(true)
    try {
      const { client } = createSandboxS3Client({
        endpoint,
        region,
        provider,
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      })
      const { ListBucketsCommand } = await import("@aws-sdk/client-s3")
      await client.send(new ListBucketsCommand({}))
      toast.success("Connection successful!")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connection failed")
    }
    setTesting(false)
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    try {
      const deviceKey = await getOrCreateDeviceKey()
      const accessKeyEnc = await encryptField(deviceKey, accessKey)
      const secretKeyEnc = await encryptField(deviceKey, secretKey)

      const cred: SandboxCredential = {
        id: crypto.randomUUID(),
        label,
        provider,
        endpoint,
        region,
        accessKeyEnc: accessKeyEnc.ciphertext,
        ivAccessKey: accessKeyEnc.iv,
        secretKeyEnc: secretKeyEnc.ciphertext,
        ivSecretKey: secretKeyEnc.iv,
        isDefault: isFirst,
        createdAt: Date.now(),
      }

      await saveCredential(cred)
      toast.success("Credential saved")
      onAdded(cred)

      // Reset form
      setLabel("")
      setEndpoint("")
      setRegion("")
      setAccessKey("")
      setSecretKey("")
      setErrors({})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    }
    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Credential</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor={`${uid}-label`}>Label</Label>
            <Input
              id={`${uid}-label`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="My S3 bucket"
            />
            {errors.label && <p className="text-xs text-destructive">{errors.label}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor={`${uid}-provider`}>Provider</Label>
            <Select value={provider} onValueChange={handleProviderChange}>
              <SelectTrigger id={`${uid}-provider`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SANDBOX_PROVIDERS.map(([key, cfg]) => (
                  <SelectItem key={key} value={key}>
                    {cfg.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor={`${uid}-endpoint`}>Endpoint</Label>
            <Input
              id={`${uid}-endpoint`}
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={providerConfig?.endpoint || "https://s3.example.com"}
            />
            {errors.endpoint && <p className="text-xs text-destructive">{errors.endpoint}</p>}
            {providerConfig?.helpText && (
              <p className="text-xs text-muted-foreground">{providerConfig.helpText}</p>
            )}
          </div>

          {provider !== "MINIO" && (
            <div className="space-y-1">
              <Label htmlFor={`${uid}-region`}>Region</Label>
              {providerConfig?.regions.length > 0 ? (
                <Select value={region} onValueChange={setRegion}>
                  <SelectTrigger id={`${uid}-region`}>
                    <SelectValue placeholder="Select region" />
                  </SelectTrigger>
                  <SelectContent>
                    {providerConfig.regions.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={`${uid}-region`}
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="us-east-1"
                />
              )}
              {errors.region && <p className="text-xs text-destructive">{errors.region}</p>}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor={`${uid}-access-key`}>Access Key ID</Label>
            <Input
              id={`${uid}-access-key`}
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
              autoComplete="off"
            />
            {errors.accessKey && <p className="text-xs text-destructive">{errors.accessKey}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor={`${uid}-secret-key`}>Secret Access Key</Label>
            <Input
              id={`${uid}-secret-key`}
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              autoComplete="new-password"
            />
            {errors.secretKey && <p className="text-xs text-destructive">{errors.secretKey}</p>}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={handleTest} disabled={testing || saving}>
              {testing && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Test
            </Button>
            <Button onClick={handleSave} disabled={saving || testing}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
