import { createFileRoute } from "@tanstack/react-router"

import { ConsoleWorkspace } from "@/components/console-workspace"
import { useInstanceWorkspace } from "@/components/instance-workspace"
import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/_app/$serverId/console")({
  head: () => ({ meta: [{ title: pageTitle("Console") }] }),
  component: ConsoleRoute,
})

function ConsoleRoute() {
  const { instance, permissions } = useInstanceWorkspace()
  return (
    <ConsoleWorkspace
      key={instance.id}
      instance={instance}
      active
      canShare={permissions.shareLogs}
      canWrite={permissions.consoleWrite}
    />
  )
}
