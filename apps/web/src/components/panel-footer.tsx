const repositoryUrl = "https://github.com/kiln-site/hearth"
const siteUrl = "https://kiln.site"

export function PanelFooter() {
  const commit = import.meta.env.VITE_KILN_BUILD_SHA.trim()
  const commitUrl = commit ? `${repositoryUrl}/commit/${commit}` : null
  const shortCommit = commit.slice(0, 7)
  const year = new Date().getUTCFullYear()

  return (
    <footer
      aria-label="Hearth Panel build information"
      className="grid h-14 shrink-0 grid-cols-[minmax(4.5rem,1fr)_auto_minmax(4.5rem,1fr)] grid-rows-2 bg-background text-center text-[11px] tracking-wide text-muted-foreground/75"
    >
      <div className="col-start-2 row-start-1 flex items-center gap-1.5 justify-self-center self-end pb-0.5 whitespace-nowrap">
        <span className="text-muted-foreground/90">Kiln · Hearth Panel</span>
        {commitUrl ? (
          <a
            href={commitUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`View deployed commit ${commit}`}
            className="font-mono text-primary/80 transition-colors hover:text-primary focus-visible:text-primary focus-visible:outline-none"
          >
            {shortCommit}
          </a>
        ) : (
          <span className="font-mono text-primary/70">Development</span>
        )}
      </div>
      <div className="col-start-2 row-start-2 flex items-center justify-center gap-x-2 justify-self-center self-start pt-0.5 whitespace-nowrap">
        <span className="flex items-center gap-1">
          <span>QuartzDev</span>
          <span aria-label="Copyright">©</span>
          <time dateTime={String(year)}>{year}</time>
        </span>
        <span className="text-border" aria-hidden="true">
          /
        </span>
        <FooterLink href="/terms">Terms of Use</FooterLink>
        <FooterLink href="/privacy">Privacy Policy</FooterLink>
      </div>
      <div className="col-start-3 row-span-2 row-start-1 flex h-full justify-self-end px-1">
        <a
          href="https://quartzdev.gg/"
          target="_blank"
          rel="noreferrer"
          aria-label="QuartzDev"
          title="QuartzDev"
          className="grid h-full w-9 place-items-center text-muted-foreground/80 transition-colors hover:bg-muted/25 hover:text-foreground focus-visible:bg-muted/25 focus-visible:text-foreground focus-visible:outline-none"
        >
          <BrandIcon
            src="/branding/quartzdev-black.svg"
            className="size-5"
          />
        </a>
        <a
          href={`${siteUrl}/discord`}
          target="_blank"
          rel="noreferrer"
          aria-label="Kiln on Discord"
          title="Discord"
          className="grid h-full w-9 place-items-center text-muted-foreground/80 transition-colors hover:bg-muted/25 hover:text-foreground focus-visible:bg-muted/25 focus-visible:text-foreground focus-visible:outline-none"
        >
          <BrandIcon src="/icons/discord.svg" className="size-5" />
        </a>
        <a
          href={`${siteUrl}/github`}
          target="_blank"
          rel="noreferrer"
          aria-label="Kiln on GitHub"
          title="GitHub"
          className="grid h-full w-9 place-items-center text-muted-foreground/80 transition-colors hover:bg-muted/25 hover:text-foreground focus-visible:bg-muted/25 focus-visible:text-foreground focus-visible:outline-none"
        >
          <BrandIcon src="/icons/github.svg" className="size-5" />
        </a>
      </div>
    </footer>
  )
}

function FooterLink({ children, href }: { children: string; href: string }) {
  return (
    <a
      href={href}
      className="transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
    >
      {children}
    </a>
  )
}

function BrandIcon({
  className,
  src,
}: {
  className?: string
  src: string
}) {
  return (
    <span
      aria-hidden="true"
      className={`block bg-current ${className ?? ""}`}
      style={{
        mask: `url(${src}) center / contain no-repeat`,
        WebkitMask: `url(${src}) center / contain no-repeat`,
      }}
    />
  )
}
