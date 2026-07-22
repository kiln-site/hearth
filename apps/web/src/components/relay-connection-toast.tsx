import * as React from "react"
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { LoaderCircle, ServerOff, Wifi, WifiOff } from "lucide-react"

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

type ApplicationConnectionState =
  | "connected"
  | "connecting"
  | "offline"
  | "unavailable"

const applicationConnectionToastId = "kiln-connection"
const applicationReconnectedToastId = "kiln-reconnected"

export const RelayConnectionToastMonitor = React.memo(
  function RelayConnectionToastMonitor() {
    const queryClient = useQueryClient()
    const router = useRouter()
    const connectionQuery = useSuspenseQuery({
      ...relayConnectionQueryOptions(queryClient),
      select: selectRelayStates,
    })
    const relays = connectionQuery.data

    useApplicationConnectionToasts({
      isError: connectionQuery.isError,
      refetch: connectionQuery.refetch,
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
            description: "Kiln will keep trying to reconnect...",
            duration: Infinity,
            action: {
              label: "View Relays",
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

function useApplicationConnectionToasts({
  isError,
  refetch,
}: {
  isError: boolean
  refetch: () => Promise<unknown>
}) {
  const [browserOnline, setBrowserOnline] = React.useState(
    () => typeof navigator === "undefined" || navigator.onLine
  )
  const [hearthReachable, setHearthReachable] = React.useState(() => !isError)
  const [verifyingConnection, setVerifyingConnection] = React.useState(false)
  const previousState = React.useRef<ApplicationConnectionState | null>(null)
  const previousQueryError = React.useRef(isError)
  const mounted = React.useRef(true)
  const cleanupTimer = React.useRef<number | undefined>(undefined)

  const retry = React.useCallback(async () => {
    setVerifyingConnection(true)
    const reachable = await checkHearthConnection()
    if (!mounted.current) return

    setHearthReachable(reachable)
    setVerifyingConnection(false)
    if (reachable) void refetch()
  }, [refetch])

  React.useEffect(() => {
    if (previousQueryError.current === isError) return
    previousQueryError.current = isError
    setHearthReachable(!isError)
  }, [isError])

  React.useEffect(() => {
    mounted.current = true
    const handleOffline = () => {
      setVerifyingConnection(false)
      setBrowserOnline(false)
    }
    const handleOnline = () => {
      setBrowserOnline(true)
      void retry()
    }

    window.addEventListener("offline", handleOffline)
    window.addEventListener("online", handleOnline)
    return () => {
      mounted.current = false
      window.removeEventListener("offline", handleOffline)
      window.removeEventListener("online", handleOnline)
    }
  }, [retry])

  const state: ApplicationConnectionState = !browserOnline
    ? "offline"
    : verifyingConnection
      ? "connecting"
      : hearthReachable
        ? "connected"
        : "unavailable"

  React.useEffect(() => {
    const previous = previousState.current
    if (previous === state) return
    previousState.current = state

    dismissToast(applicationReconnectedToastId)

    if (state === "offline") {
      showToast({
        type: "error",
        message: "You're offline",
        id: applicationConnectionToastId,
        icon: <WifiOff className="size-4 text-destructive" />,
        description:
          "Check your network connection. Kiln will reconnect automatically.",
        duration: Infinity,
      })
      return
    }

    if (state === "connecting") {
      showToast({
        type: "loading",
        message: "Reconnecting to Kiln",
        id: applicationConnectionToastId,
        icon: <LoaderCircle className="size-4 animate-spin text-primary" />,
        description: "Checking whether Hearth is available...",
        duration: Infinity,
      })
      return
    }

    if (state === "unavailable") {
      showToast({
        type: "error",
        message: "Unable to connect to Kiln",
        id: applicationConnectionToastId,
        icon: <ServerOff className="size-4 text-destructive" />,
        description:
          "Hearth isn't responding. Kiln will keep trying automatically.",
        duration: Infinity,
        action: {
          label: "Try again",
          onClick: () => void retry(),
        },
      })
      return
    }

    dismissToast(applicationConnectionToastId)
    if (previous && previous !== "connected") {
      showToast({
        type: "success",
        message: "Connected to Kiln",
        id: applicationReconnectedToastId,
        icon: <Wifi className="size-4 text-emerald-400" />,
        description: "Hearth is available again.",
        duration: 4_000,
      })
    }
  }, [retry, state])

  React.useEffect(() => {
    if (cleanupTimer.current !== undefined) {
      window.clearTimeout(cleanupTimer.current)
      cleanupTimer.current = undefined
    }

    return () => {
      cleanupTimer.current = window.setTimeout(() => {
        cleanupTimer.current = undefined
        previousState.current = null
        dismissToast(applicationConnectionToastId)
        dismissToast(applicationReconnectedToastId)
      }, 0)
    }
  }, [])
}

async function checkHearthConnection(): Promise<boolean> {
  try {
    const response = await fetch("/api/health", {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    })
    return response.ok
  } catch {
    return false
  }
}

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
