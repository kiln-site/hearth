# Hearth Rendering Architecture

This document defines Hearth's React rendering contract and the restructuring
needed to make that contract durable. Read it before changing application
shells, routes, providers, polling, shared state, or large interactive
workspaces.

Performance and perceived responsiveness are product requirements. Rendering
is not a cleanup concern to address after a feature is complete.

## Non-negotiable rendering contract

An interaction should update the smallest visual region that represents the
changed state.

- Navigating between Console, Files, and Info may update the selected
  navigation item, the instance route title, and the route content. It must not
  render the document shell, application frame, unchanged sidebar regions,
  instance identity, or footer.
- Navigating between Settings tabs may update the active tab and the tab
  content. It must not render the application shell or unchanged Settings
  header.
- Typing in a form must not render surrounding cards, lists, page layouts, or
  the application shell.
- Relay polling must not render unchanged UI. A connection-state transition may
  update the connection notice and controls whose availability changed, but it
  must not invalidate unrelated content.
- Console messages and resource samples must update only their consumers.
- Selecting a file may update file navigation and preview/editor state. It must
  not use router-wide invalidation merely to keep a deep link current.
- An offline Relay must leave cached navigation and content usable. Only the
  unavailable action or uncached content region should change.

Some updates necessarily affect more than one component. For example, route
navigation changes both the selected navigation item and the route content.
The requirement is not "zero renders"; it is "no unrelated renders."

## Render, commit, and paint are different

Use precise language when diagnosing performance:

- A **render** executes React component logic and produces a candidate tree.
- A **commit** applies accepted React changes.
- A **layout** recalculates element geometry.
- A **paint** redraws pixels.

React Scan highlights React renders. A large highlight is important evidence
that a broad component boundary rendered, but it is not by itself proof that
the browser repainted every pixel inside that boundary. Confirm important
problems using the browser, React Scan, and browser performance tooling.

Development runs under `React.StrictMode`, which intentionally performs extra
render work. Newly mounted route content may therefore appear more than once in
development. Strict Mode does not explain retained application-shell
components rendering during leaf navigation.

## Current findings

Hearth is not one monolithic React component. Its route hierarchy, query
selectors, and feature-local stores provide a useful foundation. The fragile
part is the boundary between the router, application shell, and globally
polled data.

### What is working well

- Settings and instance pages use nested routes.
- Direct `useRouterState` calls currently select narrow values rather than the
  complete router state.
- Relay data is projected through React Query selectors for several consumers.
- Console streaming and UI state use local external stores so individual
  controls and log consumers can subscribe independently.
- The Relay editor keeps ordinary text-entry state in the form instead of
  rendering the page on every keystroke.
- Context is used sparingly and provider values are generally memoized.
- Expensive workspaces are lazy-loaded where appropriate.

### Findings that drove this refactor

#### 1. The application shell owns too many subscriptions

`apps/web/src/routes/_app.tsx` subscribed to Relay connection state,
capabilities, UI preferences, and a sidebar projection of the Relay snapshot.
It then constructed the sidebar, application frame, and route content.

This makes `AppLayout` a fan-out point. If any selected result becomes unstable
or broader in the future, the complete application subtree becomes eligible to
render.

`AppFrame` is memoized, but it receives React elements through `sidebar` and
`children`. A parent render normally creates new element identities, so that
memoization is not a reliable architectural boundary.

#### 2. Router isolation currently depends on internals

The branch previously contained all of the following:

- a pnpm patch for `@tanstack/react-router`;
- a custom document-shell comparator that ignores client updates;
- a disabled router-wide catch boundary;
- file navigation that accesses `router.history._ignoreSubscribers`, which is
  a private field.

These changes demonstrated that router boundary subscriptions were causing
retained ancestors to render. They are diagnostic evidence, not an accepted
long-term architecture.

Hearth must not ship or normalize dependency patches, edited dependency
source, private framework fields, or silent framework forks as rendering
solutions. A dependency upgrade can invalidate those solutions, and private
state can leave the URL and router state inconsistent.

#### 3. Some data boundaries combine different update frequencies

`InstanceWorkspaceContext` combined instance identity, permissions, file-tree
preferences, and Relay connectivity. Those values do not change at the same
frequency. Every consumer subscribed to the complete context value.

The same principle applies to query data: static identity, connection status,
runtime state, and high-frequency resource samples should not share one broad
subscription merely because they come from the same server response.

### Boundaries implemented by the refactor

- The client and server entries compose `AppDocument` and the authenticated
  `AppFrame` outside TanStack Router's changing match tree. The exported
  `Matches` viewport is their child, so route-match commits own only the leaf
  content they can actually change instead of the complete application DOM.
- The root and authenticated pathless routes retain route metadata, loaders,
  and authentication, but no longer own persistent application chrome.
  Settings authorization reads the parent `beforeLoad` context instead of
  repeating the auth request.
- Settings and instance frames also sit above `Matches`. Their headers,
  navigation, and identity regions remain mounted while only the active leaf
  route changes.
- Authentication runs once in the parent `beforeLoad`, which executes before
  child loaders and publishes the authenticated user through route context.
  Route guards protect UI composition only; every server function and API
  endpoint must still authorize its own request.
- Sidebar and viewport regions own their own narrow React Query and Router
  selectors. Relay polling is no longer subscribed at the authenticated route
  component.
- Instance identity, permissions, file preferences, and connectivity use
  separate contexts. Connectivity is selected inside its own provider and in
  the power-control leaf, so a Relay transition does not replace the stable
  instance identity object.
- TanStack packages use exact compatible versions. The Router dependency patch,
  private history access, and document comparator were removed. The CodeMirror
  patch remains the only approved dependency patch.
- Console and file client stores are independent modules with selector-shaped
  snapshots. Text entry and streaming state stay below route and shell owners.
- Development builds expose `window.__hearthRenderAudit` through React Scan for
  interaction-scoped component traces.

#### 4. Several feature modules are too large to change safely

The largest files are approximately:

- `file-workspace.tsx`: 3,000 lines;
- `console-workspace.tsx`: 2,000 lines;
- `instance-workspace.tsx`: 1,400 lines.

File length alone does not cause rendering. Console, for example, already has
many well-isolated internal components. The problem is that large modules make
state ownership and subscription boundaries difficult to review. Notable
components such as `FileTreePanel` and `FileViewer` are still large enough that
unrelated state is easy to hoist into a shared parent.

Splitting a file without changing state ownership does not improve rendering.
A useful split gives a component its own state, subscription, and visually
bounded responsibility.

#### 5. The performance contract needs continued enforcement

React Scan is enabled in development and now exposes an interaction-scoped
browser audit. React Doctor finds general maintainability and performance
smells, but neither tool replaces the browser validation matrix. Future work
should turn the named retained-component expectations into deterministic
end-to-end assertions when T3 browser automation gains a stable CI surface.

At present, every contributor must remember the rendering rules manually.
That is why an otherwise small UI change can repeatedly reintroduce broad
renders.

### Effect is not React state management

Effect belongs in Hearth's server, service, resource, error, and runtime
boundaries. Do not introduce an Effect runtime, stream, service, or Layer into
React simply to distribute render state. React Query and small selector-based
client stores are the appropriate client subscription boundaries unless a
measured requirement proves otherwise.

## Target architecture

The application shell should be stable by construction rather than stable only
when every prop happens to retain its identity.

```text
HearthStartClient / HearthStartServer
└─ AppDocument                    outside route-match ownership
   └─ AppFrame                    retained for authenticated routes
      ├─ SidebarRegion
      │  ├─ SidebarIdentity       slow/static account data
      │  ├─ SidebarRelaySummary   narrow Relay selector
      │  ├─ InstancePicker        narrow instance-list selector
      │  └─ RouteSelection        narrow route selector
      ├─ RelayNoticeBoundary      connection-status selector only
      ├─ RouteViewport
      │  ├─ SettingsFrame         retained across Settings tabs
      │  │  └─ Matches            active Settings leaf only
      │  └─ InstanceFrame         retained across instance tabs
      │     ├─ InstanceIdentity   slow identity selector
      │     ├─ RuntimeControls    observed-state selector
      │     ├─ ResourceMeters     per-resource selectors
      │     └─ Matches            Console / Files / Info leaf only
      └─ Footer                   no application-state subscription
```

### Shell rules

- `AppShell` owns layout, not application data.
- Do not pass preconstructed `sidebar={<... />}` or similar large React nodes
  through a memoized shell as a rendering optimization.
- Shell regions subscribe independently to only the data they display.
- Route selection belongs beside the specific navigation UI that displays it.
- The route viewport must not receive Relay snapshots, user objects, or sidebar
  data solely so an ancestor can decide what to render.
- Empty, offline, loading, and unauthorized states should be route- or
  region-level boundaries rather than alternate renderings of the entire
  shell.

### Data rules

Separate data by meaning and update frequency:

- **Identity:** instance ID, name, game, version, address.
- **Authorization:** the exact permission booleans used by a region.
- **Connectivity:** Relay connected, unreachable, or unconfigured.
- **Observed runtime:** running, stopped, starting, or stopping.
- **Resources:** CPU, memory, storage, network, and uptime samples.
- **Feature data:** console lines, file tree, selected file, editor state.

A component should subscribe to the narrowest category it renders. Resource
sampling must not produce a new identity object. Connection polling must not
produce a new sidebar list when the visible sidebar fields did not change.

Selectors must be pure and return structurally stable values. Prefer primitives
or established immutable objects. Do not add timestamps, copied arrays, or new
objects to a high-level selector unless those values are visible there.

### TanStack Query mutation rules

- Include every query-function dependency in its query key.
- If a mutation returns the canonical updated object, write it immutably to the
  exact cache entry with `setQueryData` instead of refetching the same object.
- Invalidate only related keys whose canonical state was not returned by the
  mutation. Return or await the invalidation promise when the UI must stay
  pending until those queries are consistent.
- Optimistic cache writes must cancel relevant in-flight queries first,
  snapshot previous data, update immutably, roll back in `onError`, and
  invalidate in `onSettled`.
- Mutation lifecycle behavior belongs in the `useMutation` options. Call-site
  callbacks are for mounted-component side effects, since they may not run
  after the observer unmounts.
- Relay actions are never queued optimistically while disconnected. Disabled UI
  is part of the mutation contract, not merely presentation.
- Do not spread or rest-destructure complete Query result objects. Query result
  objects are not referentially stable and rest destructuring disables tracked
  property optimization; read only the fields a component displays.

### Context rules

- A context should contain values with a similar update frequency.
- Memoizing a provider value is required but is not sufficient; every consumer
  still updates when that value changes.
- Split a broad context or replace it with a selector-capable external store
  when consumers need independent fields.
- Never put high-frequency console lines or resource samples in a page-wide
  context.
- Avoid providers whose only purpose is eliminating a few explicit props.

## Patch-free restructuring record

The restructuring is incremental. Preserve one verified boundary while
changing the next, and keep the application usable after every milestone.

### Phase 0: establish the baseline

Before restructuring:

1. Record React Scan behavior for every flow in the validation matrix below.
2. Record which retained components render, not just the total render count.
3. Check browser console and network behavior.
4. Verify offline cached navigation and Relay reconnect behavior.
5. Keep evidence from both development and a production build where practical.

Do not use the dependency patch as the baseline definition of correct router
behavior. Record both the desired behavior and what official framework code
currently does.

### Phase 1: resolve the router boundary through supported APIs

1. Build a minimal reproduction of retained route ancestors rendering during
   sibling navigation.
2. Test the latest compatible official TanStack Router release.
3. Check supported router options for error, not-found, pending, and shell
   boundaries.
4. Report or contribute the minimal reproduction upstream when official code
   still invalidates retained ancestors.
5. Pin all TanStack packages to exact, known-compatible versions. Do not use
   `latest` for framework packages involved in routing or SSR integration.
6. Remove the pnpm React Router patch.
7. Remove every private-field access, including `_ignoreSubscribers`.
8. Remove app-level comparators that ignore arbitrary framework updates once
   the supported shell boundary is verified.

If the router cannot satisfy Hearth's rendering and error-recovery contract
through public APIs or an official release, stop and make the routing boundary
an explicit architecture decision. Evaluate a supported router composition or
router migration. Do not hide an internal fork inside an application feature.

File deep links must use a supported strategy. Possible designs include a
public router API that updates only the leaf match, a route-local search value,
or feature state with an explicitly synchronized public URL boundary. Choose
the design after measuring navigation, back/forward behavior, reloads, and
error recovery.

### Phase 2: make the application shell subscription-free

1. Reduce the authenticated layout to authentication and layout composition.
2. Move sidebar queries into `SidebarRegion` or smaller sidebar consumers.
3. Move Relay connection status into `RelayNoticeBoundary`.
4. Render the route outlet in an independent `RouteViewport`.
5. Keep footer and static shell elements outside changing provider values.
6. Verify that a Relay poll, settings navigation, and instance navigation do
   not execute `AppShell`.

Do not add `React.memo` everywhere during this phase. First remove unnecessary
subscriptions and unstable props. Memoization should protect an intentional
boundary, not compensate for unclear ownership.

### Phase 3: split instance data by update frequency

1. Replace the combined instance context with narrow contexts, explicit leaf
   props, or a selector-based instance store.
2. Give the identity header a selector that excludes runtime resources.
3. Give power controls an observed-state selector.
4. Give each resource meter the smallest resource selector it needs.
5. Keep permissions stable as individual booleans or a structurally stable
   permission object.
6. Keep file preferences out of Console and Info subscriptions.

After this phase, a CPU sample should not execute instance identity, route
content, file controls, console command input, or the application shell.

### Phase 4: decompose feature modules by ownership

Suggested module boundaries:

```text
components/console/
  console-workspace.tsx
  console-stream-controller.tsx
  console-log-viewport.tsx
  console-toolbar.tsx
  console-command-bar.tsx
  console-ui-store.ts

components/files/
  file-workspace.tsx
  file-selection-store.ts
  file-tree-panel.tsx
  file-viewer.tsx
  editor/
    editor.tsx
    editor-toolbar.tsx
    editor-session-store.ts

components/instance/
  instance-frame.tsx
  instance-identity.tsx
  instance-power-controls.tsx
  resource-meters.tsx
  resource-history-store.ts
```

These names are illustrative. Preserve existing behavior and avoid abstraction
for its own sake. Each extracted component should have a clear visual boundary
or state/subscription responsibility.

### Phase 5: add rendering regression checks

The development client exposes an audit at `window.__hearthRenderAudit`. Use it
in T3 Preview after the route has settled:

```js
window.__hearthRenderAudit.start()
// Perform exactly one interaction.
window.__hearthRenderAudit.stop().components
```

The result groups mounts, updates, commits, time, and unnecessary renders by
component name. Start a fresh audit for each interaction; do not combine route
loading, polling, and an input action into one trace. The final assertion must
exercise Hearth in the browser rather than only counting isolated unit renders.

The guardrail should distinguish:

- expected active-link and leaf-content renders;
- unexpected retained shell renders;
- development-only Strict Mode work;
- actual layout and paint regressions where browser tracing is needed.

Keep the test deterministic. Do not fail CI on arbitrary timing or total render
counts from unrelated development tooling.

## Primary framework references

This architecture follows the current official guides rather than framework
internals:

- [Router routing concepts](https://tanstack.com/router/latest/docs/routing/routing-concepts)
- [Router outlets](https://tanstack.com/router/latest/docs/guide/outlets)
- [Router navigation](https://tanstack.com/router/latest/docs/guide/navigation)
- [Router events](https://tanstack.com/router/latest/docs/guide/router-events)
- [Router data loading](https://tanstack.com/router/latest/docs/guide/data-loading)
- [Router external data loading](https://tanstack.com/router/latest/docs/guide/external-data-loading)
- [Router authenticated routes](https://tanstack.com/router/latest/docs/guide/authenticated-routes)
- [Router render optimizations](https://tanstack.com/router/latest/docs/guide/render-optimizations)
- [Query important defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- [Query keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)
- [Query polling](https://tanstack.com/query/latest/docs/framework/react/guides/polling)
- [Query mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations)
- [Invalidations from mutations](https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations)
- [Updates from mutation responses](https://tanstack.com/query/latest/docs/framework/react/guides/updates-from-mutation-responses)
- [Optimistic updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)
- [Query cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)
- [Query render optimizations](https://tanstack.com/query/latest/docs/framework/react/guides/render-optimizations)

## Component-authoring rules

### Place state at the smallest owner

- If only one input needs a value, keep it in that input or form component.
- If siblings need a value, lift it only to their nearest common owner.
- Do not put transient form, hover, menu, search, copied, or pending state in a
  page component.
- Prefer uncontrolled fields for submit-only forms. Use controlled fields when
  live validation or coordinated behavior requires them, but keep that state in
  a small form component.

### Subscribe where the value is rendered

- Never subscribe to the complete router state to read one pathname segment.
- Never subscribe to a complete query result high in the tree when a leaf needs
  one field.
- Use a stable selector for React Query and external stores.
- Do not pass high-frequency data through multiple layout components.
- Query loading and fetching flags are subscriptions too. Read them only where
  their UI is displayed.

### Treat object identity deliberately

- Avoid recreating selected arrays and objects when their visible values are
  unchanged.
- Memoize provider values and important object props at their true owner.
- Do not assume `React.memo` helps when props include newly created objects,
  arrays, callbacks, or React elements.
- Custom equality functions must enumerate the complete semantic contract of
  the component. They must not silently ignore future meaningful props.

### Split components for isolation, not aesthetics

Extract a component when at least one is true:

- it owns independent state;
- it owns an independent subscription;
- it is an expensive visual region that can remain stable;
- it has a distinct loading, error, or offline state;
- it is difficult to verify because unrelated logic surrounds it.

Moving JSX into a new file without changing state or subscriptions is not a
rendering optimization.

### Keep routing public and local

- Use documented router APIs only.
- Do not patch router packages or edit `node_modules`.
- Do not access underscore-prefixed or undocumented router fields.
- Route shells should not derive leaf state from the full pathname when a leaf
  or navigation component can subscribe directly.
- Preserve back, forward, reload, deep-link, pending, error, and not-found
  behavior whenever navigation changes.

### Use CSS containment appropriately

CSS `contain` can limit layout or paint work, but it does not prevent React
renders. Use it for browser rendering boundaries after confirming that it does
not break overlays, sticky positioning, focus rings, or responsive layout. Do
not use it to hide a subscription problem.

## Browser validation matrix

Every meaningful UI change must validate the affected flows plus the shared
shell flows below using T3 Code Preview at
`https://hearth.hearth.orb.local`.

### Navigation

- Console → Files → Info → Console.
- Relays → Appearance → Account → Billing → Relays.
- Switch between two instances while staying on the same instance tab.
- Browser back and forward across those transitions.
- Reload a file deep link and a Settings deep link.
- Navigate to an unknown route, then recover through client navigation.

Expected: selected navigation and changing leaf content render. Retained shell,
footer, unrelated sidebar sections, shared Settings header, and stable instance
identity do not render.

### Inputs and actions

- Type in Relay name, host, port, and key fields.
- Toggle key visibility and generate a key.
- Type in console command and console search fields.
- Search the file tree and editor.
- Rename an instance.
- Open and close menus, popovers, and the mobile sidebar.

Expected: the control and its direct feedback region render. Surrounding cards,
lists, workspaces, and shell do not render unless their visible data changed.

### Polling and connectivity

- Observe at least one connected Relay polling interval while idle.
- Turn a Relay off and continue navigating cached pages.
- Attempt unavailable Console, Files, and action flows.
- Turn the Relay back on and verify recovery without a 500 response.
- Confirm no repeated full-page renders while disconnected.

Expected: only connection feedback and data that actually changed render.
Cached content stays interactive for navigation, while actions remain disabled.

### Required checks

- Inspect React Scan overlays instead of relying only on render totals.
- Inspect the browser console for errors and repeated warnings.
- Inspect network failures, cancellations, and unexpected duplicate requests.
- Check for layout shifts and focus loss.
- Verify production build behavior for changes affected by Strict Mode or
  development instrumentation.
- Run React Doctor, typecheck, lint/check, tests, build, and the generated route
  tree check required by `AGENTS.md`.

## Instructions for future agents

These instructions are mandatory for work that changes React UI, routing,
queries, providers, polling, or client stores:

1. Read this document before editing.
2. Establish the browser and React Scan baseline before changing code.
3. State which component is expected to render for each interaction.
4. Keep new state and subscriptions at the smallest visual owner.
5. Do not patch dependencies, framework internals, or private fields.
6. Do not respond to broad renders by adding blanket memoization.
7. Do not split files and claim a rendering improvement without browser
   evidence that the subscription boundary changed.
8. Test typing, buttons, polling, route navigation, offline behavior, and
   reconnect behavior relevant to the change.
9. Continue iterating if React Scan shows retained shell regions rendering.
10. Do not push a UI change until the user has reviewed it when the task or
    branch instructions require local-only work.

If a public framework API cannot meet the rendering contract, stop and report
the limitation with a minimal reproduction and viable supported alternatives.
Do not quietly work around it inside Hearth.

## Restructure completion criteria

The rendering restructure is complete only when:

- no dependency patch is required for navigation isolation;
- no private router field is accessed;
- framework package versions are pinned and intentionally compatible;
- the application shell has no Relay polling or leaf-route subscription;
- Settings and instance sibling navigation preserve retained boundaries;
- forms and high-frequency streams update only their owning regions;
- offline and reconnect flows remain functional;
- browser validation covers the rendering matrix;
- the architecture remains understandable without custom comparators that
  ignore unknown updates.
