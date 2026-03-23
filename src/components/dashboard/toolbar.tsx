"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import {
  Columns2,
  FileSearch,
  ListTodo,
  KeyRound,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { cn } from "@/lib/utils";

interface BucketRef {
  name: string;
  credentialId: string;
}

const NAV_ITEMS = [
  { href: "/dashboard/overview", icon: BarChart3, label: "Overview" },
  { href: "/dashboard", icon: Columns2, label: "Commander" },
  { href: "/dashboard/search", icon: FileSearch, label: "Search" },
  { href: "/dashboard/tasks", icon: ListTodo, label: "Tasks" },
  { href: "/settings", icon: KeyRound, label: "Credentials" },
] as const;

export function Toolbar() {
  const pathname = usePathname();

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b bg-background/95 px-2">
      <div className="flex items-center gap-1 mr-2">
        <Image src="/bucket.svg" alt="Logo" width={18} height={18} className="shrink-0" />
        <span className="text-sm font-semibold hidden sm:inline">S3 Admin</span>
      </div>

      <Separator orientation="vertical" className="h-6" />

      <nav className="flex items-center gap-0.5 ml-1">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href}>
              <Button
                variant={isActive ? "secondary" : "ghost"}
                size="sm"
                className="h-8 gap-1.5 px-2 text-xs"
              >
                <item.icon className="h-3.5 w-3.5" />
                <span className="hidden md:inline">{item.label}</span>
              </Button>
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      <ThemeSwitcher />
    </div>
  );
}
