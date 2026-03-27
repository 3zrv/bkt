import type { Metadata } from "next"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { Toaster } from "@/components/ui/sonner"

export const metadata: Metadata = {
  title: "bkt sandbox",
  description: "Browser-direct S3 file manager — no server required",
}

export default function SandboxLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      {children}
      <Toaster />
    </ThemeProvider>
  )
}
