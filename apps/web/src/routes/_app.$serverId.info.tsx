import { createFileRoute } from "@tanstack/react-router"

import { useInstanceWorkspace } from "@/components/instance-workspace"
import { SettingsWorkspace } from "@/components/settings-workspace"
import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/_app/$serverId/info")({
  head: () => ({ meta: [{ title: pageTitle("Info") }] }),
  component: InfoRoute,
})

function InfoRoute() {
  const { instance, node, permissions } = useInstanceWorkspace()
  return (
    <SettingsWorkspace
      key={instance.id}
      instance={instance}
      node={node}
      canRename={permissions.settings}
    />
  )
}
