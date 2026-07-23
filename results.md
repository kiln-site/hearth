# Route Preloading Benchmarks

Date: 2026-07-23

Local: `https://hearth.hearth.orb.local`

Production baseline: `https://kiln.site`

## Summary

| Environment | Test case      | State             |     Mean |    Median |       p95 |
| ----------- | -------------- | ----------------- | -------: | --------: | --------: |
| Local       | Info → Console | Preload off       | 176.0 ms |  132.0 ms |  346.8 ms |
| Local       | Info → Console | Render preload    |  75.4 ms |   74.6 ms |   85.1 ms |
| Local       | Info → Files   | Preload off       | 528.6 ms |  483.8 ms |  782.3 ms |
| Local       | Info → Files   | Intent preload    | 508.8 ms |  509.6 ms |  689.5 ms |
| Production  | Info → Console | Before deployment | 117.9 ms |   91.6 ms |  168.8 ms |
| Production  | Info → Files   | Before deployment | 902.2 ms |  910.5 ms | 1274.5 ms |
| Production  | Info → Console | After deployment  | 139.9 ms |  112.4 ms |  266.6 ms |
| Production  | Info → Files   | After deployment  | 953.3 ms | 1003.8 ms | 1006.9 ms |

The local Console mean improved by 57.2%, the median by 43.5%, and p95 by
75.5%. The local Files result is smaller and tail-focused with the deliberately
short intent window: mean improved by 3.7% and p95 by 11.9%, while median was
5.3% slower.

The production after-deployment window did not reproduce the local Console
improvement: mean was 18.7% slower, median 22.8% slower, and p95 57.9% slower
than the earlier production window. Files mean was 5.7% slower and median 10.2%
slower, while p95 improved by 21.0%. Nine of the ten Files results clustered
between 1003.0 ms and 1006.9 ms, which strongly suggests a remaining
approximately one-second pending or timer boundary worth investigating.
The measured Files intent lead also increased from a 122.2 ms baseline median
to 557.3 ms after deployment. That means the scheduled click spent longer
waiting behind warm-up work; this benchmark does not isolate whether that work
is module fetch, parsing, evaluation, or another main-thread task.

## Method

- Browser: T3 Code collaborative Chromium preview at a desktop fill viewport.
- Ten valid full-document runs were recorded per test case and state.
- Every run started on the selected server's Info route with normal browser
  caching, then waited for both an idle router and the hydrated React click
  handler. This avoids mistaking server-rendered-but-not-interactive links for a
  ready app.
- Console: wait 500 ms after hydration, activate Console, and stop when the
  console search input mounts.
- Files: hover and focus Files for 150 ms, activate it, and stop when
  `[data-file-workspace]` mounts. This marker measures workspace readiness
  without waiting for file data.
- The local before set was a preload-off control using the same links and
  hydration check. Console used `preload={false}`. Files used
  `preload={false}`, no module warm handlers, and the previous route pending
  minimum. The final configuration was restored before the after set.
- p95 uses the nearest-rank definition. With ten samples, it is the largest
  sample.
- Calibration attempts, unhydrated clicks, and tooling failures were excluded
  before the final protocol. The reported local sets each contain ten valid
  runs with no discarded samples.

The production baseline used the same interactive markers against the current
deployment, with a 250 ms Console settle and an approximately 100 ms measured
Files intent lead. One Files run had a 2.76 s background long task during the
intent window; its valid click-to-interactive result remains in the set. The
after-deployment production run used that same production protocol. A
calibration set in a newly created background browser tab was excluded because
Chromium clamped its timers; the final ten-sample sets were run in the active
collaborative tab used for the production validation.

## Samples

### Local preload-off control

- Console:
  `146.4, 125.3, 132.7, 346.8, 194.2, 125.1, 128.9, 112.5, 316.8, 131.3`
- Files:
  `498.1, 589.3, 394.9, 469.4, 401.5, 782.3, 592.5, 746.0, 365.1, 446.6`
- Files intent lead:
  `152.7, 151.1, 150.9, 151.9, 151.5, 151.8, 152.6, 152.2, 151.9, 151.7`

### Local after preloading

- Console:
  `85.1, 71.4, 77.0, 75.6, 73.6, 71.9, 68.8, 84.2, 78.0, 68.0`
- Files:
  `348.3, 516.8, 471.2, 689.5, 356.6, 610.1, 407.0, 502.4, 646.5, 539.9`
- Files intent lead:
  `152.4, 151.6, 151.8, 151.8, 151.8, 151.4, 151.1, 151.5, 151.5, 152.4`

### Production before deployment

- Console:
  `166.0, 80.4, 84.0, 162.2, 84.4, 168.8, 95.2, 88.0, 168.8, 80.8`
- Files:
  `660.9, 782.7, 495.7, 783.1, 442.2, 1037.9, 1204.3, 1274.5, 1196.2, 1144.1`
- Files intent lead:
  `134.3, 115.2, 2864.8, 195.3, 126.0, 115.4, 137.2, 115.6, 117.5, 118.4`

### Production after deployment

- Console:
  `266.6, 101.9, 111.6, 95.2, 113.3, 85.0, 89.9, 125.8, 175.2, 234.6`
- Files:
  `494.2, 1004.1, 1004.0, 1006.9, 1003.5, 1003.6, 1004.4, 1005.4, 1003.6, 1003.0`
- Files intent lead:
  `943.8, 170.6, 678.5, 598.5, 491.7, 468.8, 400.3, 569.7, 555.5, 559.0`

## Browser Validation

- Console, Files, Network, and Info were activated through the real sidebar
  links and resolved to their expected short-ID routes.
- `/server/b817b002/fdsfsfslsmf` kept the selected server's sidebar, header,
  resource monitors, and power controls while rendering the 404 workspace.
- Return to Console resolved directly to `/server/b817b002/console`. A mutation
  observer recorded no intermediate change to the requested-route callout
  before the 404 workspace unmounted.
- A 349-character unknown route caused no document-level horizontal overflow.
  The requested-route region retained `overflow-x: auto` and its own scroll
  width at desktop, iPad Mini portrait, and iPhone 12 Pro portrait sizes.
- React Scan recorded no sidebar or workspace component render from Files
  intent warming, no DOM mutations, and only four internal TanStack
  `Transitioner` updates. Neither the File workspace nor Console mounted during
  the warm. File data and Console streaming therefore remained mount-gated.

## Production After Deployment

- Production served commit `a5d2a55`, which contains the route preloading and
  console reconnection UX changes.
- Ten cached Info → Console → Info → Console cycles showed no connecting or
  reconnecting notice, never disabled the command field, and only displayed the
  `Send a server command…` placeholder.
- With console WebSocket messages deliberately delayed in the browser, the
  neutral `CONNECTING TO LIVE OUTPUT…` notice appeared and later cleared while
  command input remained enabled throughout. No server command or power action
  was sent.
- `/server/91e231f0/info` resolved through the short-ID alias.
- `/server/91e231f0/fdsfsfslsmf` retained the selected server workspace chrome,
  rendered the attempted route exactly, and linked directly to
  `/server/91e231f0/console`.
- `/nonexistingpage` retained the application sidebar and footer, rendered the
  attempted route, and remained on the 404 after 3.5 seconds without appending
  `/console`.
- A 347-character server-scoped unknown route had no document-level horizontal
  overflow at 390 px, 768 px, or desktop widths. Its requested-route region
  retained `overflow-x: auto` with an independent scroll width.

## Production Timing Diagnosis

These measurements were taken after the deployment against production commit
`a5d2a55`. Sentry samples 10% of production browser traces by default, so the
Console and Files trace populations are small and include the benchmark
activity. The browser phase probes below are the stronger evidence for the
individual transition sequence.

### Warm navigation phases

| Transition                           | Milestone                                      | Time from click |
| ------------------------------------ | ---------------------------------------------- | --------------: |
| Info → Files, first open             | Files route and fallback visible               |        117.5 ms |
|                                      | 683 KB decoded workspace chunk complete        |        273.7 ms |
|                                      | Workspace module rendered; file requests begin |        540.1 ms |
|                                      | File workspace controls usable                 |        851.8 ms |
| Info → Files, module and data cached | File workspace controls usable                 |        207.5 ms |
| Info → Files, intent-warmed module   | Files route and fallback visible               |        225.5 ms |
|                                      | Fallback removed                               |        745.7 ms |
|                                      | File workspace controls usable                 |        948.2 ms |
| Files → Console, first open          | Console controls mounted                       |        225.6 ms |
|                                      | Live console stream ready                      |        732.1 ms |
| Info → Console, cached return        | Console controls and cached output mounted     |         98.6 ms |

The intent-warmed Files run reproduces the previous approximately 1,004 ms
cluster. The leaf route `/_app/server/$serverId/files/$` has no
`pendingMinMs`, so it inherits the router's 500 ms default. Its parent Files
route sets `pendingMinMs: 0`, but that does not override the leaf match. The
fallback remained visible for 520.2 ms in the probe.

The active server route also has no route `staleTime`. It reruns its
server-validation loader on child-tab navigation, including a second time after
intent preloading. Production Sentry durations for that request were:

| Destination transaction | Count |      p50 |      p95 |
| ----------------------- | ----: | -------: | -------: |
| Console                 |    39 |  67.0 ms | 209.8 ms |
| Files                   |     8 | 167.4 ms | 207.7 ms |
| Info                    |    58 |  70.8 ms | 215.3 ms |

Files then serializes code and data. The tree and activity requests did not
start until the workspace module rendered. Sentry recorded a 201.8 ms p50 for
the tree request and 68.2 ms p50 for activity. Starting these requests when the
Files route opens, in parallel with the module, removes that waterfall without
loading file data merely because the sidebar rendered.

Console's cached-return behavior is working as intended. It immediately renders
cached output, opens a new stream in the background, and the 500 ms connection
notice delay prevents a flash. The remaining 98.6 ms cached-return time was
mostly the repeated server-route validation. A first open still needs the
capability request and WebSocket authentication; the capability request had a
211.9 ms production p50 and 460.9 ms p95.

### Cold page load

Sentry's production Console pageloads recorded a 245.4 ms median TTFB, 486 ms
median FCP, and 1,374 ms median LCP across eight sampled loads. In a browser
Console load, TTFB was 257.2 ms, DOM interactive was 737.8 ms, and the console
stream request completed at 1,561.5 ms.

The application server itself is not the main cold-load bottleneck. Sentry's
origin route spans had p50/p95 durations of 58.7/90.2 ms for Console,
38.9/108.0 ms for Files, and 38.2/59.9 ms for Info. The remaining time is
browser/edge latency, asset loading, hydration, and page-specific client work.

The browser also exposed four cold-load costs:

- The base application chunk is 950,989 bytes decoded and 249,709 bytes
  compressed.
- The Files workspace adds 682,968 bytes decoded and 178,268 bytes compressed,
  primarily the editor and file-tree implementation.
- Two differently named stylesheet assets are byte-for-byte identical. Each is
  162,277 bytes decoded and about 20.7 KB compressed; the SSR asset is loaded
  first and the client asset is inserted again during hydration.
- Cloudflare injects a parser-blocking email-decoder script because the signed-in
  user's email is server-rendered. It took 471.9 ms in one cold Console load.
  The injected Cloudflare analytics beacon is a non-async module and took
  474.5–563.4 ms in the observed cold loads, extending DOMContentLoaded.

Hashed production assets currently return `Cache-Control: max-age=14400`
without `immutable`, so repeat visits after four hours needlessly revalidate or
download versioned assets.

### Optimization order

1. Remove the inherited 500 ms pending minimum on the Files leaf route and stop
   revalidating the unchanged server match during child-tab swaps.
2. Start Files tree/activity requests in parallel with its workspace module on
   route entry. Preserve the current behavior of not fetching file data from a
   passive sidebar render.
3. Rewrite the SSR stylesheet reference to the client stylesheet name during
   asset normalization instead of copying the same CSS under a second hash.
4. Disable or exclude authenticated user emails from Cloudflare email
   obfuscation, and make the analytics beacon non-blocking or remove it.
5. Give content-hashed assets a one-year immutable cache policy.
6. Split the Files home/tree from CodeMirror so the editor can be loaded after
   the Files workspace is interactive, and defer optional Sentry Replay code
   until after the application is interactive.

## Local implementation verification

The routing and loading changes were verified against
`https://hearth.hearth.orb.local` before commit:

- New links use the eight-character server alias. Both the previous
  relay-qualified ID and the full instance SHA redirect to that alias.
- Canonical redirects preserve the nested route, query string, and hash. A
  relay-qualified `/server/.../fdsfsfslsmf?debug=1#requested` URL became
  `/server/b817b002/fdsfsfslsmf?debug=1#requested` before the server-scoped 404
  rendered.
- `/nonexistingpage` remained on the requested URL after an additional
  1.5-second wait and rendered the global 404 frame.
- The Files parent and leaf routes both report `pendingMinMs: 0`; the server
  route reports an infinite stale time.
- A first Files navigation started its tree/activity server requests at
  21–22 ms and the workspace module at 75 ms in the same browser trace, rather
  than waiting for the workspace module before starting data.
- The Files workspace code finished at 72 ms, activity at 222 ms, and the tree
  at 317 ms before the idle CodeMirror preload began at 447 ms. No editor was
  mounted during the preload. Opening a file afterward issued zero editor
  module requests and only requested the selected file's data.
- A cold direct file route now starts the CodeMirror import from the parent
  Files route, in parallel with the workspace. Initial file selections skip the
  idle scheduler entirely; the Files home still renders without mounting an
  editor and retains its post-tree idle preload.
- Across a Files → Info transition, the sidebar, instance workspace shell, and
  power control remained the same connected DOM nodes.
- Long server-scoped 404 routes produced no document overflow at 390×844 or
  768×1024. The requested-route field retained its independent horizontal
  scrolling.

The production client bundle now contains:

| Asset                            |         Before |     After |
| -------------------------------- | -------------: | --------: |
| Initial Files workspace, decoded |      682.97 KB | 303.42 KB |
| Initial Files workspace, gzip    |      178.27 KB |  85.84 KB |
| Deferred CodeMirror, decoded     | included above | 379.39 KB |
| Deferred CodeMirror, gzip        | included above | 123.65 KB |

That removes 55.6% of decoded code and 51.9% of gzip transfer from the initial
Files workspace load while preserving the complete editor once a file opens.
The final build emitted one global stylesheet, and the production server
returned `Cache-Control: public, max-age=31536000, immutable` for the hashed
stylesheet asset.
