"use client"

import { Suspense } from "react"
import { Toolbar } from "@/components/dashboard/toolbar"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Suspense>
        <Toolbar />
      </Suspense>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
