import * as React from "react"
import type { BrickVariable, BrickVariableValue } from "@workspace/contracts"

import { Input } from "@workspace/ui/components/input"

export const BrickVariableField = React.memo(function BrickVariableField({
  name,
  definition,
  value,
  onChange,
}: {
  name: string
  definition: BrickVariable
  value: BrickVariableValue | undefined
  onChange: (value: BrickVariableValue | undefined) => void
}) {
  if (definition.type === "boolean") {
    return (
      <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border/75 bg-background/45 px-3 py-2.5 text-xs">
        <span>
          <span className="block font-medium">{definition.label}</span>
          <span className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">
            {definition.description}
          </span>
        </span>
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
          className="accent-primary"
        />
      </label>
    )
  }

  return (
    <label className="block space-y-1.5 text-[10px] font-medium text-muted-foreground">
      <span className="flex items-center justify-between gap-2">
        <span>{definition.label}</span>
        <span className="font-mono text-[8px] text-muted-foreground/55">
          {name}
        </span>
      </span>
      {definition.options ? (
        <select
          value={value === undefined ? "" : String(value)}
          onChange={(event) => {
            if (event.target.value === "" && !definition.required) {
              onChange(undefined)
              return
            }
            const option = definition.options?.find(
              (candidate) => String(candidate) === event.target.value
            )
            if (option !== undefined) onChange(option)
          }}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-ring"
          required={definition.required}
        >
          {!definition.required ? <option value="">Not set</option> : null}
          {definition.options.map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      ) : (
        <Input
          type={
            definition.sensitive
              ? "password"
              : definition.type === "number"
                ? "number"
                : "text"
          }
          value={value === undefined ? "" : String(value)}
          onChange={(event) => {
            const next = event.target.value
            onChange(
              definition.type === "number"
                ? next === ""
                  ? undefined
                  : Number(next)
                : next
            )
          }}
          pattern={definition.rules?.pattern}
          min={definition.rules?.min}
          max={definition.rules?.max}
          minLength={definition.rules?.minLength}
          maxLength={definition.rules?.maxLength}
          required={definition.required}
        />
      )}
      <span className="block text-[9px] leading-4 font-normal">
        {definition.description}
      </span>
    </label>
  )
})
