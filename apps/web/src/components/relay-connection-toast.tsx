import * as React from "react"
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { Wifi, WifiOff } from "lucide-react"

import { dismissToast, showToast } from "@workspace/ui/components/sonner"

import { RelayToastTitle } from "@/components/relay-toast-title"
import { relayConnectionQueryOptions } from "@/lib/query-options"
import type { RelayConnection } from "@/lib/query-options"

const emptyRelayStates: ReadonlyArray<RelayState> = []

interface RelayState {
  id: string
  name: string
  status: "connected" | "unreachable"
}

export const RelayConnectionToastMonitor = React.memo(
  function RelayConnectionToastMonitor() {
    const queryClient = useQueryClient()
    const router = useRouter()
    const { data: relays } = useSuspenseQuery({
      ...relayConnectionQueryOptions(queryClient),
      select: selectRelayStates,
    })
    const previousStatuses = React.useRef(
      new Map<string, RelayState["status"]>()
    )
    const activeToastIds = React.useRef(new Set<string>())
    const cleanupTimer = React.useRef<number | undefined>(undefined)

    React.useEffect(() => {
      if (cleanupTimer.current !== undefined) {
        window.clearTimeout(cleanupTimer.current)
        cleanupTimer.current = undefined
      }

      return () => {
        cleanupTimer.current = window.setTimeout(() => {
          cleanupTimer.current = undefined
          previousStatuses.current.clear()
          for (const toastId of activeToastIds.current) dismissToast(toastId)
          activeToastIds.current.clear()
        }, 0)
      }
    }, [])

    React.useEffect(() => {
      const nextStatuses = new Map<string, RelayState["status"]>()

      for (const relay of relays) {
        const disconnectToastId = relayDisconnectToastId(relay.id)
        const reconnectToastId = relayReconnectToastId(relay.id)
        const previousStatus = previousStatuses.current.get(relay.id)
        nextStatuses.set(relay.id, relay.status)

        if (relay.status === "unreachable" && previousStatus !== relay.status) {
          dismissToast(reconnectToastId)
          activeToastIds.current.add(disconnectToastId)
          showToast({
            type: "warning",
            message: <RelayToastTitle name={relay.name} state="disconnected" />,
            id: disconnectToastId,
            icon: <WifiOff className="size-4 text-amber-300" />,
            description: "Hearth will keep trying to reconnect.",
            duration: Infinity,
            action: {
              label: "View relays",
              onClick: () => void router.navigate({ to: "/settings/relays" }),
            },
          })
        } else if (
          relay.status === "connected" &&
          previousStatus === "unreachable"
        ) {
          dismissToast(disconnectToastId)
          activeToastIds.current.delete(disconnectToastId)
          showToast({
            type: "success",
            message: <RelayToastTitle name={relay.name} state="reconnected" />,
            id: reconnectToastId,
            icon: <Wifi className="size-4 text-emerald-400" />,
            description: "Hearth is receiving live Relay data again.",
            duration: 4_000,
          })
        }
      }

      for (const relayId of previousStatuses.current.keys()) {
        if (nextStatuses.has(relayId)) continue
        const disconnectToastId = relayDisconnectToastId(relayId)
        dismissToast(disconnectToastId)
        dismissToast(relayReconnectToastId(relayId))
        activeToastIds.current.delete(disconnectToastId)
      }

      previousStatuses.current = nextStatuses
    }, [relays, router])

    return null
  }
)

function selectRelayStates(
  connection: RelayConnection
): ReadonlyArray<RelayState> {
  return connection.status === "unconfigured" || connection.status === "paused"
    ? emptyRelayStates
    : connection.relays
}

function relayDisconnectToastId(relayId: string): string {
  return `relay-disconnected:${relayId}`
}

function relayReconnectToastId(relayId: string): string {
  return `relay-reconnected:${relayId}`
}
