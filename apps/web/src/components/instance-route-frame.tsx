import * as React from "react"
import { Outlet } from "@tanstack/react-router"

import { InstanceWorkspace } from "@/components/instance-workspace"

type InstanceRouteFrameProps = Omit<
  React.ComponentProps<typeof InstanceWorkspace>,
  "children"
>

export const InstanceRouteFrame = React.memo(function InstanceRouteFrame({
  instance,
  fileTreePreferences,
  permissions,
  relayConnected,
}: InstanceRouteFrameProps) {
  return (
    <InstanceWorkspace
      instance={instance}
      fileTreePreferences={fileTreePreferences}
      permissions={permissions}
      relayConnected={relayConnected}
    >
      <Outlet />
    </InstanceWorkspace>
  )
})
