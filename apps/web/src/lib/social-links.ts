import { redirect } from "@tanstack/react-router"

export const socialLinks = {
  discord: {
    href: "https://discord.gg/gu76VAtSK5",
    label: "Kiln on Discord",
    title: "Discord",
    icon: "/icons/discord.svg",
  },
  github: {
    href: "https://github.com/kiln-site",
    label: "Kiln on GitHub",
    title: "GitHub",
    icon: "/icons/github.svg",
  },
  x: {
    href: "https://x.com/quartzdevgg",
    label: "QuartzDev on X",
    title: "X",
    icon: "/icons/x.svg",
  },
} as const

export type SocialLinkId = keyof typeof socialLinks

/** Footer order for social brand links (excludes QuartzDev site mark). */
export const footerSocialLinkIds = [
  "discord",
  "github",
  "x",
] as const satisfies ReadonlyArray<SocialLinkId>

/** Shareable path aliases that resolve to a social destination. */
export const socialRedirectRoutes = {
  discord: "discord",
  github: "github",
  x: "x",
  twitter: "x",
} as const satisfies Record<string, SocialLinkId>

export type SocialRedirectPath = keyof typeof socialRedirectRoutes

export function redirectToSocial(path: SocialRedirectPath): never {
  throw redirect({
    href: socialLinks[socialRedirectRoutes[path]].href,
  })
}
