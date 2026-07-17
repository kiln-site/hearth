import { createFileRoute } from "@tanstack/react-router"

import { useInstanceWorkspace } from "@/components/instance-workspace"
import { SettingsWorkspace } from "@/components/settings-workspace"
import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/_app/$serverId/info")({
  head: () => ({ meta: [{ title: pageTitle("Info") }] }),
  component: InfoRoute,
})

function InfoRoute() {
  const { instance, node, onInstanceUpdate, permissions } =
    useInstanceWorkspace()
  return (
    <SettingsWorkspace
      instance={instance}
      node={node}
      canRename={permissions.settings}
      onInstanceUpdate={onInstanceUpdate}
    />
  )
}
