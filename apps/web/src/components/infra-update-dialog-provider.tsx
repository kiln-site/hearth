import * as React from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { useRouter, useRouterState } from "@tanstack/react-router"

import { InfraUpdatesDialog } from "@/components/infra-updates-dialog"
import { accessCapabilitiesQueryOptions } from "@/lib/query-options"
import {
  consumeUpdateDialogResume,
  type UpdateDialogResume,
} from "@/lib/system-update-dialog-resume"

type InfraUpdateDialogState = {
  open: boolean
  relayId: string | null
  requestId: number
  resume: UpdateDialogResume | null
}

export interface InfraUpdateDialogStore {
  close: () => void
  getServerSnapshot: () => InfraUpdateDialogState
  getSnapshot: () => InfraUpdateDialogState
  open: (relayId?: string) => void
  restore: (resume: UpdateDialogResume) => void
  subscribe: (listener: () => void) => () => void
}

const closedUpdateDialogState: InfraUpdateDialogState = {
  open: false,
  relayId: null,
  requestId: 0,
  resume: null,
}

const InfraUpdateDialogContext =
  React.createContext<InfraUpdateDialogStore | null>(null)

function createInfraUpdateDialogStore(): InfraUpdateDialogStore {
  let state = closedUpdateDialogState
  const listeners = new Set<() => void>()

  function publish(nextState: InfraUpdateDialogState) {
    state = nextState
    for (const listener of listeners) listener()
  }

  return {
    close: () =>
      publish({
        open: false,
        relayId: null,
        requestId: state.requestId,
        resume: null,
      }),
    getServerSnapshot: () => closedUpdateDialogState,
    getSnapshot: () => state,
    open: (relayId) =>
      publish({
        open: true,
        relayId: relayId ?? null,
        requestId: state.requestId + 1,
        resume: null,
      }),
    restore: (resume) =>
      publish({
        open: true,
        relayId: resume.targetKey.startsWith("relay:")
          ? resume.targetKey.slice("relay:".length)
          : null,
        requestId: state.requestId + 1,
        resume,
      }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function useInfraUpdateDialogStore(): InfraUpdateDialogStore {
  const store = React.useContext(InfraUpdateDialogContext)
  if (!store) {
    throw new Error(
      "useInfraUpdateDialogStore must be used inside InfraUpdateDialogProvider"
    )
  }
  return store
}

export const InfraUpdateDialogProvider = React.memo(
  function InfraUpdateDialogProvider({
    children,
  }: {
    children: React.ReactNode
  }) {
    const [store] = React.useState(() => createInfraUpdateDialogStore())
    const awayFromInfrastructure = useRouterState({
      select: (state) => !state.location.pathname.startsWith("/infra"),
    })

    React.useEffect(() => {
      if (awayFromInfrastructure && store.getSnapshot().open) store.close()
    }, [awayFromInfrastructure, store])

    React.useEffect(() => {
      const resume = consumeUpdateDialogResume()
      if (resume) store.restore(resume)
    }, [store])

    return (
      <InfraUpdateDialogContext.Provider value={store}>
        {children}
        <InfraUpdatesDialogHost store={store} />
      </InfraUpdateDialogContext.Provider>
    )
  }
)

const InfraUpdatesDialogHost = React.memo(function InfraUpdatesDialogHost({
  store,
}: {
  store: InfraUpdateDialogStore
}) {
  const { data: capabilities } = useSuspenseQuery(
    accessCapabilitiesQueryOptions()
  )

  return capabilities.isPlatformAdmin ? (
    <PlatformAdminInfraUpdatesDialogHost store={store} />
  ) : null
})

const PlatformAdminInfraUpdatesDialogHost = React.memo(
  function PlatformAdminInfraUpdatesDialogHost({
    store,
  }: {
    store: InfraUpdateDialogStore
  }) {
    const router = useRouter()
    const returnToUpdater = React.useCallback(
      (relayId: string | null) => {
        void router.navigate({ to: "/infra/relays" }).then(() => {
          store.open(relayId ?? undefined)
        })
      },
      [router, store]
    )
    const handleOpenChange = React.useCallback(
      (open: boolean) => {
        if (!open) store.close()
      },
      [store]
    )
    const state = React.useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      store.getServerSnapshot
    )

    return (
      <InfraUpdatesDialog
        initialRelayId={state.relayId}
        open={state.open}
        requestId={state.requestId}
        resume={state.resume}
        onRetryTarget={returnToUpdater}
        onOpenChange={handleOpenChange}
      />
    )
  }
)
