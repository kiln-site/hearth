import * as React from "react"
import { CircleAlert } from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

export const TailscaleRelayUpdateHint = React.memo(
  function TailscaleRelayUpdateHint({ relayName }: { relayName: string }) {
    const message = `Update ${relayName} before adding its servers to Tailscale`

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            tabIndex={0}
            aria-label={message}
            className="grid size-4 shrink-0 place-items-center text-amber-600 outline-none focus-visible:ring-1 focus-visible:ring-ring dark:text-amber-400"
          >
            <CircleAlert className="size-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {message}
        </TooltipContent>
      </Tooltip>
    )
  }
)
