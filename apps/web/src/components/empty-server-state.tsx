export function EmptyServerState({
  canProvision,
}: {
  canProvision: boolean
}) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center bg-background px-6 text-center">
      <div className="max-w-sm border border-border/70 bg-card/35 p-6">
        <p className="font-heading text-xl font-semibold">No managed servers</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {canProvision
            ? "Open Servers and use Add Server to provision an instance, or configure a Relay connection from Settings."
            : "No server instances have been assigned to your account yet."}
        </p>
      </div>
    </div>
  )
}
