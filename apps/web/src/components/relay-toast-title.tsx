interface RelayToastTitleProps {
  name: string
  state: string
}

export function RelayToastTitle({ name, state }: RelayToastTitleProps) {
  return (
    <>
      <span className="font-semibold text-foreground">{name}</span> {state}
    </>
  )
}
