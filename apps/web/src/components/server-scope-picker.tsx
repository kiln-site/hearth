import * as React from "react"
import { ArrowLeftRight, Server } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"

import {
  ServerPickerList,
  serverPickerOptionKey,
  type ServerPickerOption,
} from "@/components/server-picker-list"
import { WorkspaceSummaryCard } from "@/components/workspace-summary-card"

export const ServerScopePicker = React.memo(function ServerScopePicker({
  allDescription = "Every accessible instance",
  allLabel = "All servers",
  onSelect,
  selectedRelayName,
  selectedServer,
  servers,
}: {
  allDescription?: string
  allLabel?: string
  onSelect: (server: ServerPickerOption | null) => void
  selectedRelayName?: string
  selectedServer: ServerPickerOption | null
  servers: ReadonlyArray<ServerPickerOption>
}) {
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const selectedKeys = React.useMemo(
    () =>
      new Set(selectedServer ? [serverPickerOptionKey(selectedServer)] : []),
    [selectedServer]
  )
  const selectServer = React.useCallback(
    (server: ServerPickerOption) => {
      onSelect(server)
      setPickerOpen(false)
    },
    [onSelect]
  )
  const selectionMetadata = selectedServer
    ? selectedServer.id
    : `${servers.length} accessible ${servers.length === 1 ? "instance" : "instances"}`

  return (
    <div className="mb-3">
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <WorkspaceSummaryCard
          action={
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
              >
                <ArrowLeftRight />
                {selectedServer ? "Change server" : "Choose server"}
              </Button>
            </PopoverTrigger>
          }
          icon={<Server className="size-5" />}
          title={selectedServer?.name ?? allLabel}
          titleAccessory={
            <Badge variant="outline" className="font-mono text-[9px]">
              {selectedServer?.relayName ?? selectedRelayName ?? "All Relays"}
            </Badge>
          }
        >
          <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground/70">
            {selectionMetadata}
          </p>
        </WorkspaceSummaryCard>
        <PopoverContent
          align="end"
          className="w-[min(32rem,calc(100vw-2rem))] p-1.5"
        >
          <ServerPickerList
            allOption={{
              description: allDescription,
              label: allLabel,
              selected: selectedServer === null,
              onSelect: () => {
                onSelect(null)
                setPickerOpen(false)
              },
            }}
            selectedKeys={selectedKeys}
            servers={servers}
            onSelect={selectServer}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
})
