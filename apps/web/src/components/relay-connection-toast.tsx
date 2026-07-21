import * as React from "react"
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { WifiOff } from "lucide-react"

import { toast } from "@workspace/ui/components/sonner"

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
          for (const toastId of activeToastIds.current) toast.dismiss(toastId)
          activeToastIds.current.clear()
        }, 0)
      }
    }, [])

    React.useEffect(() => {
      const nextStatuses = new Map<string, RelayState["status"]>()

      for (const relay of relays) {
        const toastId = relayToastId(relay.id)
        const previousStatus = previousStatuses.current.get(relay.id)
        nextStatuses.set(relay.id, relay.status)

        if (relay.status === "unreachable" && previousStatus !== relay.status) {
          activeToastIds.current.add(toastId)
          toast.warning(`${relay.name} disconnected`, {
            id: toastId,
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
          toast.dismiss(toastId)
          activeToastIds.current.delete(toastId)
        }
      }

      for (const relayId of previousStatuses.current.keys()) {
        if (nextStatuses.has(relayId)) continue
        const toastId = relayToastId(relayId)
        toast.dismiss(toastId)
        activeToastIds.current.delete(toastId)
      }

      previousStatuses.current = nextStatuses
    }, [relays, router])

    return null
  }
)

function selectRelayStates(
  connection: RelayConnection
): ReadonlyArray<RelayState> {
  return connection.status === "unconfigured"
    ? emptyRelayStates
    : connection.relays
}

function relayToastId(relayId: string): string {
  return `relay-disconnected:${relayId}`
}
