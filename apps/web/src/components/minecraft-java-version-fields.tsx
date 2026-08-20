import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import type { Brick, BrickVariable } from "@workspace/contracts"

import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

import { BrickVersionPicker } from "@/components/brick-version-picker"
import { brickArtifactCatalog } from "@/lib/brick-artifact"
import {
  javaVersionSelectOptions,
  recommendedSupportedJavaVersion,
  stringVariableAllows,
} from "@/lib/brick-variables"
import { brickVersionsQueryOptions } from "@/lib/query-options"

export function javaVersionDefinition(brick: {
  variables: Brick["variables"]
}): BrickVariable | null {
  const definition = brick.variables.java_version
  return definition?.type === "string" ? definition : null
}

export function supportedBrickVersions(
  versions: ReadonlyArray<string>,
  definition: BrickVariable,
  defaultVersion: string
): Array<string> {
  const allowed = versions.filter((version) =>
    stringVariableAllows(definition, version)
  )
  if (defaultVersion && !allowed.includes(defaultVersion)) {
    return stringVariableAllows(definition, defaultVersion)
      ? [defaultVersion, ...allowed]
      : allowed
  }
  return allowed
}

export const MinecraftJavaVersionFields = React.memo(
  function MinecraftJavaVersionFields({
    brickId,
    disabled = false,
    environment,
    javaInputName,
    javaVersion,
    onJavaVersionChange,
    onVersionChange,
    variableDefinitions,
    version,
    versionInputName,
  }: {
    brickId: string
    disabled?: boolean
    environment: Readonly<Record<string, string>>
    javaInputName?: string
    javaVersion: string
    onJavaVersionChange: (value: string) => void
    onVersionChange: (value: string) => void
    variableDefinitions: Brick["variables"]
    version: string
    versionInputName?: string
  }) {
    const labelId = React.useId()
    const javaLabelId = React.useId()
    const versionDefinition = variableDefinitions.version
    const javaDefinition = javaVersionDefinition({
      variables: variableDefinitions,
    })
    const catalog = brickArtifactCatalog({ runtime: { environment } })
    const versionsQuery = useQuery({
      ...brickVersionsQueryOptions(catalog?.type ?? "", catalog?.variant ?? ""),
      enabled: catalog !== null,
    })
    const defaultVersion =
      versionDefinition?.default === undefined
        ? ""
        : String(versionDefinition.default)
    const versions = React.useMemo(
      () =>
        versionDefinition
          ? supportedBrickVersions(
              versionsQuery.data?.versions ?? [],
              versionDefinition,
              defaultVersion
            )
          : [],
      [defaultVersion, versionDefinition, versionsQuery.data?.versions]
    )
    const usePicker =
      catalog !== null &&
      !versionsQuery.isError &&
      (versionsQuery.isPending || versions.length > 0)
    const required = Boolean(
      versionDefinition?.required && versionDefinition.default === undefined
    )
    const javaVersions = React.useMemo(
      () =>
        javaDefinition
          ? javaVersionSelectOptions(javaDefinition, javaVersion)
          : [],
      [javaDefinition, javaVersion]
    )
    const changeVersion = React.useCallback(
      (nextVersion: string) => {
        onVersionChange(nextVersion)
        if (!javaDefinition) return
        const nextJava = recommendedSupportedJavaVersion(
          brickId,
          javaDefinition,
          nextVersion
        )
        if (nextJava) onJavaVersionChange(nextJava)
      },
      [brickId, javaDefinition, onJavaVersionChange, onVersionChange]
    )

    if (!versionDefinition || versionDefinition.type !== "string") return null

    const javaRequired = Boolean(
      javaDefinition?.required && javaDefinition.default === undefined
    )

    return (
      <div className="space-y-1.5 text-xs font-medium text-muted-foreground">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <span id={labelId}>{versionDefinition.label}</span>
            {usePicker ? (
              <BrickVersionPicker
                labelledBy={labelId}
                name={versionInputName ?? "version"}
                value={version}
                versions={versions}
                disabled={disabled}
                loading={versionsQuery.isPending}
                maxLength={versionDefinition.rules?.maxLength}
                minLength={versionDefinition.rules?.minLength}
                pattern={versionDefinition.rules?.pattern}
                required={required}
                onChange={changeVersion}
              />
            ) : (
              <Input
                aria-labelledby={labelId}
                name={versionInputName ?? "version"}
                value={version}
                onChange={(event) => changeVersion(event.currentTarget.value)}
                placeholder="Enter a version"
                pattern={versionDefinition.rules?.pattern}
                minLength={versionDefinition.rules?.minLength}
                maxLength={versionDefinition.rules?.maxLength}
                disabled={disabled}
                className="font-mono tabular-nums"
                required={required}
              />
            )}
            <span className="block text-[0.5625rem] leading-4 font-normal">
              {versionDefinition.description}
            </span>
          </div>
          {javaDefinition ? (
            <div
              className={
                javaVersions.length > 0
                  ? "w-[5.75rem] shrink-0 space-y-1.5"
                  : "w-[7.5rem] shrink-0 space-y-1.5"
              }
            >
              <span id={javaLabelId}>Java</span>
              {javaVersions.length > 0 ? (
                <>
                  {javaInputName ? (
                    <input
                      type="hidden"
                      name={javaInputName}
                      value={javaVersion}
                    />
                  ) : null}
                  <Select
                    value={javaVersion}
                    onValueChange={onJavaVersionChange}
                    disabled={disabled}
                  >
                    <SelectTrigger
                      aria-labelledby={javaLabelId}
                      className="h-8 w-full px-2.5 font-mono text-xs tabular-nums"
                    >
                      <SelectValue placeholder="Java" />
                    </SelectTrigger>
                    <SelectContent className="z-[70]">
                      {javaVersions.map((option) => (
                        <SelectItem
                          key={option}
                          className="font-mono text-xs tabular-nums"
                          value={option}
                        >
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              ) : (
                <Input
                  aria-labelledby={javaLabelId}
                  name={javaInputName ?? "java_version"}
                  value={javaVersion}
                  onChange={(event) =>
                    onJavaVersionChange(event.currentTarget.value)
                  }
                  placeholder="Java"
                  pattern={javaDefinition.rules?.pattern}
                  minLength={javaDefinition.rules?.minLength}
                  maxLength={javaDefinition.rules?.maxLength}
                  disabled={disabled}
                  className="font-mono tabular-nums"
                  required={javaRequired}
                />
              )}
            </div>
          ) : null}
        </div>
        {javaDefinition ? (
          <span className="block text-[0.5625rem] leading-4 font-normal">
            {javaDefinition.description}
          </span>
        ) : null}
      </div>
    )
  }
)
