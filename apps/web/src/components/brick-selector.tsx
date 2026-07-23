import * as React from "react"
import type { Brick } from "@workspace/contracts"
import { PackagePlus } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@workspace/ui/components/combobox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"

import { ServerTypeIcon } from "@/components/server-type-icon"

export type BrickSelection =
  | { kind: "catalog"; brick: Brick }
  | { kind: "custom"; source: string }

function brickSearchText(brick: Brick): string {
  return [
    brick.metadata.name,
    brick.metadata.game,
    brick.metadata.id,
    brick.metadata.author,
    ...(brick.metadata.tags ?? []),
  ]
    .join(" ")
    .toLowerCase()
}

function filterBrick(item: Brick, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return brickSearchText(item).includes(normalized)
}

const EMPTY_BRICKS: Array<Brick> = []

export const BrickCombobox = React.memo(function BrickCombobox({
  bricks,
  value,
  onValueChange,
  disabled = false,
  id,
}: {
  bricks: Array<Brick>
  value: Brick | null
  onValueChange: (brick: Brick | null) => void
  disabled?: boolean
  id?: string
}) {
  return (
    <Combobox
      items={bricks.length > 0 ? bricks : EMPTY_BRICKS}
      value={value}
      onValueChange={onValueChange}
      itemToStringLabel={(brick) => brick.metadata.name}
      itemToStringValue={(brick) => brick.source}
      isItemEqualToValue={(a, b) => a.source === b.source}
      filter={filterBrick}
      disabled={disabled}
      autoHighlight
    >
      <ComboboxInput
        id={id}
        placeholder="Search bricks…"
        className="w-full"
        showClear={value !== null}
      />
      <ComboboxContent className="z-[60]">
        <ComboboxEmpty>No bricks match your search.</ComboboxEmpty>
        <ComboboxList>
          {(brick) => (
            <ComboboxItem key={brick.source} value={brick}>
              <ServerTypeIcon
                implementation={brick.metadata.id}
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {brick.metadata.name}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {brick.metadata.game} · {brick.metadata.id}
                </span>
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
})

export const BrickSelectionFields = React.memo(function BrickSelectionFields({
  bricks,
  selection,
  onSelectionChange,
  disabled = false,
}: {
  bricks: Array<Brick>
  selection: BrickSelection | null
  onSelectionChange: (selection: BrickSelection | null) => void
  disabled?: boolean
}) {
  const catalogValue =
    selection?.kind === "catalog" ? selection.brick : null
  const customOpen = selection?.kind === "custom"

  return (
    <div className="space-y-3">
      <label className="block space-y-1.5 text-[10px] font-medium text-muted-foreground">
        <span>Brick</span>
        <BrickCombobox
          bricks={bricks}
          value={catalogValue}
          disabled={disabled || customOpen}
          onValueChange={(brick) => {
            onSelectionChange(brick ? { kind: "catalog", brick } : null)
          }}
        />
      </label>

      {customOpen ? (
        <div className="space-y-2 rounded-xl border border-dashed border-primary/30 bg-primary/[0.04] p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
              <PackagePlus className="size-3.5 text-primary" />
              Custom recipe URL
            </p>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={disabled}
              onClick={() =>
                onSelectionChange(
                  bricks[0] ? { kind: "catalog", brick: bricks[0] } : null
                )
              }
            >
              Use catalog
            </Button>
          </div>
          <Input
            type="url"
            value={selection.source}
            disabled={disabled}
            onChange={(event) =>
              onSelectionChange({
                kind: "custom",
                source: event.target.value,
              })
            }
            placeholder="https://example.com/my-brick.yml"
            required
          />
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full justify-start"
          disabled={disabled}
          onClick={() => onSelectionChange({ kind: "custom", source: "" })}
        >
          <PackagePlus />
          Custom Brick
        </Button>
      )}
    </div>
  )
})

export const BrickSelectDialog = React.memo(function BrickSelectDialog({
  open,
  onOpenChange,
  bricks,
  initial,
  title = "Select Brick",
  description = "Search the catalog or provide a custom recipe URL.",
  confirmLabel = "Select Brick",
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bricks: Array<Brick>
  initial: BrickSelection | null
  title?: string
  description?: string
  confirmLabel?: string
  onConfirm: (selection: BrickSelection) => void
}) {
  const [selection, setSelection] = React.useState<BrickSelection | null>(
    initial
  )

  React.useEffect(() => {
    if (open) setSelection(initial)
  }, [initial, open])

  const canConfirm =
    selection?.kind === "catalog" ||
    (selection?.kind === "custom" && selection.source.trim().length > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <BrickSelectionFields
          bricks={bricks}
          selection={selection}
          onSelectionChange={setSelection}
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canConfirm || !selection}
            onClick={() => {
              if (!selection || !canConfirm) return
              onConfirm(selection)
              onOpenChange(false)
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})
