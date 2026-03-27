"use client";

import { useState, useEffect } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SandboxCommander } from "@/components/sandbox/sandbox-commander";
import { CredentialManager } from "@/components/sandbox/credential-manager";
import { listCredentials, type SandboxCredential } from "@/lib/sandbox/store";

type View = "commander" | "credentials";

export function SandboxApp() {
  const [credentials, setCredentials] = useState<SandboxCredential[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>("commander");

  useEffect(() => {
    listCredentials()
      .then((creds) => {
        setCredentials(creds);
        // Show credential manager on first visit
        if (creds.length === 0) setView("credentials");
      })
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Minimal top bar */}
      <header className="flex h-10 items-center justify-between border-b bg-background px-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">bkt sandbox</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-medium">
            browser-only
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-[11px] text-muted-foreground">
            Enjoying this?{" "}
            <a
              href="https://github.com/3zrv/bkt"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Self-host
            </a>{" "}
            for file preview, tasks &amp; more.
          </span>
          {view === "commander" && credentials.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => setView("credentials")}
            >
              <Settings className="h-3.5 w-3.5" />
              Credentials
            </Button>
          )}
        </div>
      </header>

      <Separator />

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {view === "credentials" || credentials.length === 0 ? (
          <div className="mx-auto max-w-lg p-6">
            <CredentialManager
              credentials={credentials}
              onCredentialsChange={(creds) => {
                setCredentials(creds);
                // Switch to commander once first credential is added
                if (creds.length > 0 && credentials.length === 0) {
                  setView("commander");
                }
              }}
              onClose={
                credentials.length > 0 ? () => setView("commander") : undefined
              }
            />
          </div>
        ) : (
          <SandboxCommander credentials={credentials} />
        )}
      </main>
    </div>
  );
}
