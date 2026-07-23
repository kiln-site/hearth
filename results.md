# Route Preloading Benchmarks

Date: 2026-07-23

Local: `https://hearth.hearth.orb.local`

Production baseline: `https://kiln.site`

## Summary

| Environment | Test case | State | Mean | Median | p95 |
| --- | --- | --- | ---: | ---: | ---: |
| Local | Info → Console | Preload off | 176.0 ms | 132.0 ms | 346.8 ms |
| Local | Info → Console | Render preload | 75.4 ms | 74.6 ms | 85.1 ms |
| Local | Info → Files | Preload off | 528.6 ms | 483.8 ms | 782.3 ms |
| Local | Info → Files | Intent preload | 508.8 ms | 509.6 ms | 689.5 ms |
| Production | Info → Console | Current deployment | 117.9 ms | 91.6 ms | 168.8 ms |
| Production | Info → Files | Current deployment | 902.2 ms | 910.5 ms | 1274.5 ms |
| Production | Info → Console | After deployment | Pending | Pending | Pending |
| Production | Info → Files | After deployment | Pending | Pending | Pending |

The local Console mean improved by 57.2%, the median by 43.5%, and p95 by
75.5%. The local Files result is smaller and tail-focused with the deliberately
short intent window: mean improved by 3.7% and p95 by 11.9%, while median was
5.3% slower.

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
after-deployment production run must use that same production protocol.

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

### Production current deployment

- Console:
  `166.0, 80.4, 84.0, 162.2, 84.4, 168.8, 95.2, 88.0, 168.8, 80.8`
- Files:
  `660.9, 782.7, 495.7, 783.1, 442.2, 1037.9, 1204.3, 1274.5, 1196.2, 1144.1`
- Files intent lead:
  `134.3, 115.2, 2864.8, 195.3, 126.0, 115.4, 137.2, 115.6, 117.5, 118.4`

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

Pending deployment. Re-run both production cases ten times using the production
baseline protocol and append the samples and comparison here.
