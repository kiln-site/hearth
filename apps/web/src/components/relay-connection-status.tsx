import * as React from "react"
import { RefreshCw, WifiOff } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

export type RelayStatus = "connected" | "unconfigured" | "unreachable"

export function RelayConnectionNotice({
  retry,
  status,
}: {
  retry: () => Promise<void>
  status: RelayStatus
}) {
  const [checking, setChecking] = React.useState(false)
  if (status !== "unreachable") return null

  async function handleRetry() {
    setChecking(true)
    try {
      await retry()
    } finally {
      setChecking(false)
    }
  }

  return (
    <div
      role="status"
      className="absolute top-2 left-1/2 z-50 flex w-max max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-2 border border-amber-400/20 bg-amber-400/[0.055] py-1.5 pr-1.5 pl-3 text-amber-100 shadow-lg shadow-black/20 backdrop-blur-xl"
    >
      <WifiOff className="size-3.5 shrink-0 text-amber-300" />
      <p className="truncate text-[11px] font-semibold">Relay Disconnected</p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 gap-1.5 px-2 text-[10px] text-amber-100 hover:bg-amber-400/10 hover:text-amber-50"
        disabled={checking}
        onClick={() => void handleRetry()}
      >
        <RefreshCw className={checking ? "animate-spin" : undefined} />
        <span>Refresh</span>
      </Button>
    </div>
  )
}
