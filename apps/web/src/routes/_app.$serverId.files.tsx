import * as React from "react"
import { createFileRoute, useMatch } from "@tanstack/react-router"
import { FileCode2 } from "lucide-react"

import {
  FileTreeLoadingPanel,
  FileWorkspaceLoadingState,
} from "@/components/file-tree-loading-panel"
import { useInstanceWorkspace } from "@/components/instance-workspace"
import { pageTitle } from "@/lib/page-title"

const FileWorkspace = React.lazy(async () => {
  const module = await import("@/components/file-workspace")
  return { default: module.FileWorkspace }
})

export const Route = createFileRoute("/_app/$serverId/files")({
  head: () => ({ meta: [{ title: pageTitle("Files") }] }),
  component: FilesRoute,
})

function FilesRoute() {
  const filePath = useMatch({
    from: "/_app/$serverId/files/$",
    shouldThrow: false,
    select: (match) => match.params._splat,
  })
  const { fileTreePreferences, instance, permissions } = useInstanceWorkspace()

  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-0 flex-1 bg-card">
          <FileTreeLoadingPanel
            collapsed={false}
            width={fileTreePreferences.width}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex h-14 shrink-0 border-b">
              <div className="flex min-w-0 flex-1 items-center gap-2.5 px-3 md:gap-3">
                <FileCode2 className="size-5 shrink-0 text-primary" />
                {filePath ? (
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {fileNameFromPath(filePath)}
                    </p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground sm:text-[11px]">
                      /data/{normalizeFilePath(filePath)}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="h-3 w-24 animate-pulse bg-muted/35" />
                    <div className="h-2.5 w-40 animate-pulse bg-muted/25" />
                  </div>
                )}
              </div>
            </div>
            <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
              <FileWorkspaceLoadingState
                title="Opening file workspace"
                description="Preparing the file browser and editor."
              />
            </div>
          </div>
        </div>
      }
    >
      <FileWorkspace
        key={instance.id}
        instance={instance}
        active
        routeFilePath={filePath}
        canShare={permissions.shareLogs}
        canWrite={permissions.filesWrite}
        openTreeOnEntry
        initialTreeCollapsed={fileTreePreferences.collapsed}
        initialTreeWidth={fileTreePreferences.width}
      />
    </React.Suspense>
  )
}

function normalizeFilePath(path: string) {
  return path.replace(/^\/+/, "")
}

function fileNameFromPath(path: string) {
  const normalized = normalizeFilePath(path)
  return normalized.split("/").filter(Boolean).at(-1) ?? normalized
}
