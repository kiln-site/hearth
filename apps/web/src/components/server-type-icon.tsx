import type * as React from "react"
import { Box } from "lucide-react"

type ServerTypeIconProps = Omit<React.ComponentProps<"svg">, "children"> & {
  implementation: string
}

/**
 * Loader marks adapted from Modrinth's loader tag registry. Keeping the paths
 * local makes the server switcher work when Hearth has no public network access.
 */
export function ServerTypeIcon({
  implementation,
  ...props
}: ServerTypeIconProps) {
  const type = implementation.toLowerCase().replaceAll(/[^a-z]/gu, "")

  if (type === "paper" || type === "papermc") {
    return (
      <svg viewBox="0 0 24 24" fill="none" {...props}>
        <path
          d="m12 18 6 2 3-17L2 14l6 2"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="m9 21-1-5 4 2-3 3Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="m12 18-4-2 10-9-6 11Z" fill="currentColor" />
      </svg>
    )
  }

  if (type === "velocity") {
    return (
      <svg viewBox="0 0 500 500" fill="currentColor" {...props}>
        <path d="m236.25 232.55-54.08-73.79a11.86 11.86 0 0 0-11.91-4.62L84 171.57a11.88 11.88 0 0 0-8 5.88l-42.64 77.07a11.84 11.84 0 0 0 .81 12.75l54.21 74a11.86 11.86 0 0 0 11.91 4.62l86-17.37a11.85 11.85 0 0 0 8-5.89l42.78-77.3a11.86 11.86 0 0 0-.82-12.78Zm-59.45 74.21a9.57 9.57 0 0 1-13.39-2.06l-31-42.24a16 16 0 0 0-16-6.21l-52.58 10.63a9.58 9.58 0 0 1-3.83-18.78l57-11.52a16 16 0 0 0 10.81-7.92L156.42 177a9.58 9.58 0 0 1 16.75 9.25L146.81 234a16 16 0 0 0 1.09 17.16l31 42.23a9.58 9.58 0 0 1-2.1 13.37Z" />
        <circle cx="416.44" cy="236.11" r="9.83" />
        <path d="M458.29 265.6H280.52a9.83 9.83 0 1 1 0-19.66h106.22a9.84 9.84 0 0 0 0-19.67h-70.2a9.83 9.83 0 1 1 0-19.66H422.9a9.84 9.84 0 0 0 0-19.67H202.83l33.42 45.61a11.86 11.86 0 0 1 .81 12.75l-42.78 77.3a11.75 11.75 0 0 1-1.4 2h212.29a9.83 9.83 0 1 0 0-19.66h-53.53a9.84 9.84 0 1 1 0-19.67h106.65a9.84 9.84 0 1 0 0-19.67Z" />
      </svg>
    )
  }

  if (type === "folia") {
    return (
      <svg viewBox="0 0 24 24" fill="none" {...props}>
        <path
          d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (type === "fabric") {
    return (
      <svg viewBox="0 0 24 24" fill="none" {...props}>
        <path
          d="m820 761-85.6-87.6c-4.6-4.7-10.4-9.6-25.9 1-19.9 13.6-8.4 21.9-5.2 25.4 8.2 9 84.1 89 97.2 104 2.5 2.8-20.3-22.5-6.5-39.7 5.4-7 18-12 26-3 6.5 7.3 10.7 18-3.4 29.7-24.7 20.4-102 82.4-127 103-12.5 10.3-28.5 2.3-35.8-6-7.5-8.9-30.6-34.6-51.3-58.2-5.5-6.3-4.1-19.6 2.3-25 35-30.3 91.9-73.8 111.9-90.8"
          transform="matrix(.08671 0 0 .0867 -49.8 -56)"
          stroke="currentColor"
          strokeWidth="23"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (type === "neoforge") {
    return (
      <svg viewBox="0 0 24 24" fill="none" {...props}>
        <g
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m12 19.2v2m-3.6-19.9c.5 1.5.7 3 .1 4.6-.2.5-.9 1.5-1.6 1.5m8.7-6.1c-.5 1.5-.7 3-.1 4.6.2.6.9 1.5 1.6 1.5M3.6 15.8H1.9m18.5 0h1.7M3.2 12.1H1.5m19.3 0h1.8M8.1 12.7v1.6m7.8-1.6v1.6M10.8 18H12m0 1.2L10.8 18m2.4 0H12m0 1.2 1.2-1.2" />
          <path d="M4 9.7c-.5 1.2-.8 2.4-.8 3.7 0 3.1 2.9 6.3 5.3 8.2.9.7 2.2 1.1 3.4 1.1m.1-17.8c-1.1 0-2.1.2-3.2.7m11.2 4.1c.5 1.2.8 2.4.8 3.7 0 3.1-2.9 6.3-5.3 8.2-.9.7-2.2 1.1-3.4 1.1M12 4.9c1.1 0 2.1.2 3.2.7M4 9.7c-.2-1.8-.3-3.7.5-5.5s2.2-2.6 3.9-3m11.6 8.5c.2-1.9.3-3.7-.5-5.5s-2.2-2.6-3.9-3M12 21.2l-2.4.4m2.4-.4 2.4.4" />
        </g>
      </svg>
    )
  }

  if (type === "forge") {
    return (
      <svg viewBox="0 0 24 24" fill="none" {...props}>
        <path
          d="M2 7.5h8v-2h12v2s-7 3.4-7 6 3.1 3.1 3.1 3.1l.9 3.9H5l1-4.1s3.8.1 4-2.9c.2-2.7-6.5-.7-8-6Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (type === "purpur") {
    return (
      <svg viewBox="0 0 24 24" fill="none" {...props}>
        <path
          d="m12 2.4-9 4.55 9 5 9-5-9-4.55Zm0 9.55v9.65m0-9.65L3 6.95v9.95l9 4.7 9-4.7V6.95m-13.5-2.3 9 4.78v9.95m0-9.95L7.5 14v5.38"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (type === "spigot" || type === "spigotmc") {
    return (
      <svg viewBox="0 0 24 24" fill="none" {...props}>
        <path
          d="M10.7 2.3 12.6 1l2 1.3h4.8v2.8h-5.3v4h1.9v2.7h-.9l1.2 1.9h2.6v-1.9h2.6v1.9H23v4.8h-1.5V20h-2.6v-2.3h-2.6l-4 1.3-4.9-1.3-1.1 1.3 1.3 1.1-.2 2.1-3 .1L1 20.7l.4-1.6 1.8-.4 1.2-3.5 5.7-3.1-.5-1.3V9h1.7V5.1H6V2.3h4.7Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (type === "vanilla" || type === "minecraft") {
    return (
      <svg viewBox="0 0 20 20" fill="currentColor" {...props}>
        <path d="M9.5 1.13a1 1 0 0 1 1 0l1.75 1a1 1 0 1 1-1 1.74L10 3.15l-1.25.72a1 1 0 1 1-1-1.74l1.75-1ZM5.62 4.5a1 1 0 0 1-.37 1.37L5.02 6l.23.13a1 1 0 1 1-1 1.74L4 7.72V8a1 1 0 0 1-2 0V6c0-.36.2-.7.52-.88l1.73-.99a1 1 0 0 1 1.37.37Zm8.76 0a1 1 0 0 1 1.37-.37l1.73.99c.32.18.52.52.52.88v2a1 1 0 1 1-2 0v-.28l-.25.15a1 1 0 1 1-1-1.74l.23-.13-.23-.13a1 1 0 0 1-.37-1.37ZM7.38 8.5a1 1 0 0 1 1.37-.37l1.25.72 1.25-.72a1 1 0 1 1 1 1.74L11 10.58V12a1 1 0 1 1-2 0v-1.42l-1.25-.71a1 1 0 0 1-.37-1.37ZM3 11a1 1 0 0 1 1 1v1.42l1.25.71a1 1 0 1 1-1 1.74l-1.75-1A1 1 0 0 1 2 14v-2a1 1 0 0 1 1-1Zm14 0a1 1 0 0 1 1 1v2a1 1 0 0 1-.5.87l-1.75 1a1 1 0 1 1-1-1.74l1.25-.71V12a1 1 0 0 1 1-1Zm-9.62 5.5a1 1 0 0 1 1.37-.37l.25.15V16a1 1 0 1 1 2 0v.28l.25-.15a1 1 0 1 1 1 1.74l-1.74.99a1 1 0 0 1-1.02 0l-1.74-.99a1 1 0 0 1-.37-1.37Z" />
      </svg>
    )
  }

  return <Box {...props} />
}
