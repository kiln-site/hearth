# Before We Go Live

- [ ] Close the database pool explicitly during graceful shutdown.
- [ ] Ensure database connections are released even if `RELEASE_LOCK()` fails.
- [ ] Configure the database pool's maximum idle connections and idle timeout.
- [ ] Add a finite database request queue and acquisition/request timeouts.
- [ ] Add metrics for pool usage, queued requests, query latency, and MySQL connection errors.
- [ ] Replace per-tab relay snapshot polling with one cached snapshot per Relay and broadcast updates through SSE or WebSockets.
- [ ] Cache Relay metadata and tokens instead of querying them on every snapshot request.
- [ ] Cache authorization data with appropriate invalidation.
- [ ] Fan out one console stream per instance to multiple viewers instead of attaching once per viewer.
- [ ] Set and document a total database connection budget across all Hearth replicas.
- [ ] Load-test snapshot updates, authentication, database overload behavior, and console streaming before public deployment.
- [ ] Setup appp analytics (customized umami, or look into posthog)

... This is a running list, still got lots to do, and only adding things as i find theme
