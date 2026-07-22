# Hearth ↔ Relay Networking Plan

> Status: implementation and local integration validation complete on
> `networking-overhaul`; awaiting PR audit.

## Implementation checkpoints

Completed and locally verified:

- Persistent Relay identity, SQLite client/invitation state, one-time manual and
  environment pairing, unique encrypted Hearth keypairs, and live revocation.
- Mutually authenticated, multiplexed `kiln-relay.v1` WSS control sessions with
  deadlines, cancellation, heartbeats, bounded buffers, reconnect jitter, and
  multiple concurrent Hearth clients.
- Relay-managed CA/leaf TLS lifecycle, external certificate validation, CA
  download/trust probe, and browser trust guidance without requiring port 443.
- Browser proof-of-possession capabilities, shared direct console streaming,
  commands/completions and resource/status streaming, plus direct HTTPS
  upload/download with exact Origin/path/action scope, anti-replay nonces,
  atomic uploads, byte ranges, and response hashes. Direct console/resource
  traffic automatically falls back through Hearth; UTF-8 files up to 2 MiB
  have a safe Hearth fallback while large/binary transfers fail with actionable
  edge guidance.
- Relay-owned SFTP on configurable `KILN_RELAY_SFTP_PORT` (default 2022), a
  persistent host key, email/`dev123` development authentication, live Hearth
  authorization, multi-instance virtual roots, action-by-action filesystem
  grants, bounded sessions/handles, and complete shell/exec/PTY rejection.
- Direct file and SFTP boundaries fail closed outside Linux: the supported
  Relay container uses `/proc/self/fd` to pin authorized files/directories and
  prevent ancestor-symlink swaps between validation and I/O.
- Full-access/read-only foundations, stable action keys, Relay/instance cache
  synchronization, and browser/Hearth/Relay disconnect recovery notices.
- Relay-authoritative naming plus platform-admin management for pending pairing
  invitations and paired Hearth clients in both the Hearth UI and host recovery
  CLI, including live grant changes and revocation.
- Optional per-Hearth source CIDR policies based on the actual TCP peer, with
  observed-address shortcuts, persisted connection metadata, and forced
  reauthentication after policy changes.
- Relay setup surfaces for the advertised SFTP host, configurable port, stable
  host-key fingerprint, and explicitly development-only credentials.
- Shared Relay resource sampling with ordered sequence numbers, initial pushed
  control snapshots, per-instance mutation serialization, bounded control,
  browser, transfer, and SFTP concurrency, and durable redacted security audit
  history visible to platform administrators.
- Managed-certificate renewal and mounted-certificate validation/hot reload on
  the active listener while preserving the last valid certificate, plus
  optional public host inference with explicit NAT/Docker/privacy warnings.
- Legacy authenticated HTTP control routes were removed. Hearth fallback opens
  capability-authenticated browser WSS operations over the paired control
  channel and streams console output as same-origin NDJSON.
- Relay edge modes `none`, `hearth`, and `traefik`, including a pinned
  Relay-managed Traefik, HTTP-01 ACME renewal, port-conflict diagnostics,
  public browser probes, and automatic direct-to-Hearth runtime fallback.
- Relay-authoritative Ember web routes with hostname/path uniqueness,
  permission-gated Hearth APIs, a minimal Network tab, dynamic bundled
  Traefik configuration, and Docker-label carriers for an existing Traefik.
  Route changes do not restart the Ember.
- Development resolves `@workspace/contracts` from source. Clean package
  generation can replace `packages/contracts/dist` without restarting Relay,
  stranding Vite's package resolver, or returning a transient Hearth 500/502.

The deliberately deferred production extensions are ACME DNS-01 providers and
production SFTP credential/public-key issuance. Bundled Traefik implements
HTTP-01 issuance and renewal; DNS-01 remains useful for wildcard certificates
or sites where public port 80 cannot be exposed. The requested email/`dev123`
SFTP scaffold still refuses to start in production. Production rollout still
requires deployment-specific public DNS/ACME, IPv6, load, and adversarial
security validation; those are operational gates rather than unfinished local
implementation.

## Summary

Replace the current Hearth-to-Relay HTTP API and shared bearer token with a
hybrid transport:

- One long-lived, mutually authenticated WebSocket connection per
  Hearth–Relay pairing for the control plane.
- Direct browser-to-Relay WSS for live console/log and resource streams when a
  trusted public edge is available, with a same-origin Hearth fallback.
- Direct browser-to-Relay HTTPS for large uploads and downloads. Small UTF-8
  transfers may safely fall back through Hearth.
- A Relay-owned, SFTP-only SSH listener for permission-scoped access to one or
  more instance filesystems.

Hearth always initiates the connection. Relay listens on a configurable port
(4100 by default) and may accept multiple Hearth connections at the same time.
Port 443 remains optional.

Pairing is an explicit, short-lived enrollment operation. Each Hearth–Relay
pairing receives a unique Ed25519 client keypair. Hearth keeps the private key;
Relay stores only the corresponding public key. Relay proves its own identity
with a separate persistent keypair. WSS provides transport encryption while
the application keys provide stable identities that do not depend on hostnames,
IP addresses, reverse proxies, or a particular TLS certificate.

```text
Hearth A ── authenticated WSS ──┐
Hearth B ── authenticated WSS ──┼──> Relay :4100
Hearth C ── authenticated WSS ──┘

Browser ── short-lived capability ──> Traefik :443 ──> Relay :4100
    └──────────────── Hearth fallback ──────────────> Relay control WSS

SFTP client ── user authentication over SSH/SFTP ──> Relay :2022
```

One TLS listener and certificate can serve HTTPS and WSS on port 4100. The
certificate must be trusted by the browser for direct browser traffic; it does
not have to be served on port 443.

## Edge delivery and Ember web routes

`KILN_RELAY_PROXY` selects the initial edge mode. Relay persists the chosen
mode in `/data/proxy.json`; changing the environment later does not silently
replace an operator's saved choice.

| Mode      | Browser hot path                                             | Public Ember sites                              | Operator responsibility                                                                            |
| --------- | ------------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `none`    | Direct Relay edge when trusted, then Hearth fallback         | Existing Traefik discovers Relay route carriers | Configure the Relay's direct public edge and an existing Traefik certificate resolver named `kiln` |
| `hearth`  | Console, resources, commands, and supported files use Hearth | Not provided                                    | Keep Hearth reachable; add an external edge before enabling public Ember sites                     |
| `traefik` | Public WSS/HTTPS on 443, then Hearth fallback                | Relay-managed dynamic routes                    | Point public DNS at Relay and expose public TCP 80/443                                             |

The bundled mode starts `kiln-traefik` from the exact pinned image configured
by `KILN_RELAY_TRAEFIK_IMAGE` (default `traefik:v3.6.6`). Relay generates its
static and dynamic file-provider configuration and mounts only those files,
ACME state, and the Relay CA. The Traefik container does **not** receive the
Docker socket. Traefik terminates public TLS, renews certificates with ACME
HTTP-01, and validates Relay's managed upstream certificate with Relay's CA.
Port 443 is therefore optional for the Relay listener but required by this
convenience edge. A user-managed edge can publish any external port.

Before starting bundled Traefik, Relay reports Docker owners of ports 80/443.
Docker cannot see a non-container host process, so a bind failure is translated
into the same actionable conflict error. Public reachability cannot be proven
from inside Docker; Hearth exposes a browser-side trust probe that distinguishes
DNS, firewall/NAT, and certificate/ACME failure from Relay control connectivity.

Every Ember created by the new Relay lifecycle receives baseline Traefik
metadata, but remains disabled for automatic Docker-provider exposure. A web
route is an explicit Relay-owned record:

```text
https://<hostname>[/path] -> http://kiln-<instance-short-id>:<target-port>
```

Hostname/path pairs are unique across the Relay, target ports are restricted to
1–65535, and each Ember may have at most 16 routes. The user creates the DNS
record. In bundled mode Relay atomically rewrites the watched dynamic
configuration; in `none` mode it maintains a small Nginx route carrier bearing
standard Traefik Docker labels. The carrier resolves Ember DNS lazily, so an
offline/stopped Ember does not enter a restart loop. Both paths apply changes
dynamically without restarting the Ember. Optional path stripping supports
routes such as `https://donutsmp.com/map` to an Ember service root.

The fallback boundary remains deliberate:

- instance lifecycle, metadata, route changes, file trees, and small control
  calls always travel through Hearth;
- console and resource streams prefer direct WSS and automatically retry via
  Hearth with a visible `CONNECTED THROUGH HEARTH` notice;
- commands follow the active console policy and fall back to the control WSS;
- small valid UTF-8 files up to 2 MiB may be proxied by Hearth;
- large or binary transfer bytes require a trusted direct edge and never
  silently downgrade or reinterpret their contents.

User-visible errors distinguish browser offline, Hearth unreachable, Relay
control disconnected, direct edge trust failure, Hearth proxy failure, port
conflict, and DNS/ACME reachability. Sentry spans/tags identify the Relay and
operation without recording capabilities, proofs, file data, or pairing
secrets.

### Reset and compatibility notes

There is intentionally no compatibility layer for bearer-token/HTTP Relays or
old container naming. Existing deployments should recreate Relay pairing and
recreate Embers so the new `kiln-<short-id>` network alias and baseline labels
exist. Relay SQLite migration 4 creates `relay_web_routes`; a clean reset may
drop `/data/network/relay.sqlite` and `/data/proxy.json` together with the rest
of Relay identity/pairing state. There are no new Hearth MySQL tables for web
routes because Relay is authoritative. Removing only `relay_web_routes` loses
configured public routes but not Ember data. Operators must remove any stale
`kiln-route-*` or `kiln-traefik` containers if manually abandoning the new edge
state. In development, Hearth and Relay import `@workspace/contracts` through
its source export, so resetting or regenerating `packages/contracts/dist` no
longer creates a package-entry gap that can leave either dev server offline.

## Goals

- Encrypt all Hearth–Relay control and data traffic in transit.
- Authenticate both Relay and Hearth without IP allowlists.
- Give every Hearth–Relay pairing an independent identity.
- Support multiple Hearths connected to one Relay concurrently.
- Use one multiplexed control connection for requests, responses, state, and
  low-volume events while sending high-volume, user-facing streams and file
  bytes directly between the browser and Relay.
- Detect disconnections promptly and recover without stale UI state.
- Support a one-time environment-driven pairing path for colocated Compose
  deployments without creating a second long-term authentication mechanism.
- Keep setup simple for a single Docker container with `/data` and
  `/var/run/docker.sock` mounted.
- Work directly on any TCP port and behind an existing reverse proxy.
- Make credentials independently revocable and commands attributable.
- Provide SFTP file transfer without shell access and without installing an
  SSH/SFTP daemon inside each instance container.
- Prefer bounded work, predictable memory use, and minimal unnecessary polling.
- Preserve the existing product UI outside Relay setup and connection-status
  behavior.

## Non-goals

- Relay discovery across the public internet. A Hearth must receive the Relay
  endpoint through a pairing bundle, DNS, or manual configuration.
- Protecting a host after an attacker controls Relay or its Docker socket.
  Docker socket access is effectively host-root access.
- Preserving compatibility with legacy bearer-token Relays. This migration may
  intentionally break them.
- Replacing the browser-to-Hearth application API. Hearth remains the user
  authentication, authorization, metadata, and capability-issuing control
  plane; only selected high-volume data paths connect directly to Relay.
- Building a central Kiln rendezvous or certificate service.

## Architecture decisions

### Connection direction

Hearth connects to Relay. Relay never needs a Hearth hostname or IP address.
Changing a Hearth address does not require Relay configuration.

### Connection count

Relay accepts multiple authenticated Hearth sessions. A normal installation
uses one WebSocket per Hearth–Relay pairing and multiplexes all operations over
it. Relay must impose configurable global and per-client session limits to
protect memory and file descriptors.

A horizontally scaled Hearth deployment is one logical Hearth identity. Its
replicas may establish a small bounded number of sessions using that identity;
each connection still receives a unique session ID. Distinct Hearth
installations never share private keys.

### Port selection

WSS works on any TCP port. The default advertised endpoint is conceptually:

```text
wss://relay.example.com:4100/v1/socket
```

Port 443 is a convenience for firewalls and default URL behavior, not a
requirement. Game-server ports are unrelated to the Relay control port.

The common configuration should use simple host and port values:

```text
KILN_RELAY_HOST=relay.example.com
KILN_RELAY_PORT=4100
KILN_RELAY_SFTP_PORT=2022
```

Relay constructs the fixed `/v1/socket` WSS endpoint from those values. Keep
bind configuration separate (`KILN_RELAY_BIND_HOST=0.0.0.0`) so an advertised
hostname is never confused with the interface on which Relay listens.

SFTP uses the SSH protocol and therefore has its own listener and persistent
SSH host key. It does not use Relay's HTTPS certificate and should not be
multiplexed onto port 4100. `KILN_RELAY_SFTP_PORT` defaults to 2022 and remains
configurable independently.

Advanced reverse-proxy deployments may additionally override the advertised
public port or complete URL when the external mapping differs from the Relay
listener. Normal direct deployments should not need to assemble a URL.

### WebSocket scope

The persistent Hearth–Relay control plane uses WSS. Relay also exposes a
separate browser WSS endpoint for console/log and resource streams. Large file
transfers use streaming HTTPS because HTTP Range, content length, download
managers, cache controls, cancellation, and resumable transfers fit files
better than WebSocket framing.

A minimal unauthenticated `/health` response or TCP health check may remain for
Docker, load balancers, and the setup trust probe. It must expose no node data
and is not part of the control protocol.

### Hybrid transport boundary

Hearth remains authoritative for users and permissions. A browser never
receives Hearth's long-term Relay private key. For a direct operation:

1. The signed-in browser asks Hearth for a narrowly scoped, short-lived
   capability.
2. Hearth checks both the user's permission and the paired Hearth client's
   Relay grant, then signs the capability with that pairing's private key.
3. The browser presents it directly to Relay over trusted WSS or HTTPS.
4. Relay verifies the signature with the paired Hearth public key, checks all
   claims, and intersects the requested action with the client's current
   grants before touching Docker or the filesystem.

The direct edge is limited initially to:

- Console/log streams and console commands over WSS.
- Resource metrics and instance status over WSS.
- File upload, download, and backup transfer bytes over HTTPS.

Instance creation, deletion, configuration, file metadata/tree operations,
small editor reads/writes, pairing, and administrative state continue through
Hearth's API and the persistent Hearth–Relay control socket. This keeps
business rules and most UI behavior centralized without proxying hot bytes.

### SFTP service and virtual filesystem

Relay hosts one multi-user SFTP service for the node. It is not installed in
game containers and it never exposes an operating-system shell. Relay accepts
only the SSH `session` channel with the `sftp` subsystem and rejects shell,
exec, PTY, SCP, port forwarding, agent forwarding, X11 forwarding, and every
other subsystem or channel type.

An authenticated user's SFTP root is a synthetic directory containing only the
instances they can access:

```text
/
├── <instance-id>/
│   └── <that instance's files>
└── <other-instance-id>/
    └── <that instance's files>
```

The directories are virtual routing entries, not symlinks and not container
roots. Each entry delegates to the same guarded `InstanceFilesystem` used by
Hearth file operations and direct HTTPS transfers. A user with access to one
instance sees one directory; a user with access to several sees all authorized
directories in the same SFTP session. Directory listing hides unauthorized
instances rather than returning permission errors that disclose their IDs.

Permissions remain per instance and per operation. `instance.sftp.connect`
allows login, while existing `instance.files.*` actions decide whether each
instance directory can be listed, read, created, written, renamed, chmodded, or
deleted. Read-only access is therefore naturally supported. Revocation removes
the instance from future sessions and terminates active sessions whose
permission snapshot is no longer valid.

Relay generates one persistent Ed25519 SSH host key under `/data`, prints its
SHA-256 fingerprint at initialization, and exposes the fingerprint through
Hearth so clients can verify the host. Host-key rotation is an explicit audited
operation with an overlap/warning period; it is independent of TLS certificate
renewal.

For the first development milestone only:

- The SFTP username is the Hearth user's email address.
- The password is the hardcoded value `dev123`.
- This authenticator is enabled only by an explicit development flag, is
  rejected when the Relay is in production mode, and must never be presented
  as a deployable credential scheme.
- Because an email contains `@`, clients should set the username separately
  (for example an OpenSSH config or `-oUser=user@example.com`) instead of the
  ambiguous `user@example.com@relay.example.com` shorthand. SSH permits `@` in
  the username; some client URL/command syntaxes make it awkward.
- Until stable SFTP identities exist, development authentication supports one
  authoritative Hearth per Relay or rejects an email found in more than one
  paired Hearth. It must never guess between identities.

Relay validates `dev123`, then asks the authoritative Hearth over the existing
bidirectional control WSS for that email's current instance/action map. A
missing Hearth, ambiguous identity, disabled user, or missing permission fails
closed with the same generic authentication response. Passwords are never
logged or sent to Sentry.

Before production, replace the scaffold with a separate generated, revocable
SFTP password for each user/Relay relationship, stored only as an Argon2id
verifier, plus optional public keys scoped to selected instances. Do not reuse
the Hearth account password. The account may still expose multiple authorized
instance directories; the credential authenticates the user, while the current
per-instance permission map authorizes paths and operations.

### Cryptography

- Use Node's built-in, audited cryptographic APIs. Do not implement crypto
  primitives.
- Use Ed25519 for Relay application identity and Hearth client identities.
- Store private keys as PKCS#8 and public keys as SPKI.
- Generate enrollment tokens from at least 32 random bytes and encode them as
  base64url.
- Store only `SHA-256(token)` for an outstanding invitation. A password KDF is
  unnecessary because the token is uniformly random and high entropy.
- Compare authentication values in constant time where comparisons apply.
- Require secure random nonces and never reuse an authentication challenge.
- Prefer TLS 1.3 and permit TLS 1.2 only if deployment compatibility requires
  it. Disable obsolete protocol versions and weak cipher suites.

Application authentication is intentionally separate from TLS identity. This
allows Relay to sit behind a TLS-terminating reverse proxy and allows TLS
certificates to renew without re-pairing every Hearth.

## Trust and key model

Every relationship has three distinct categories of material:

| Material                                     | Stored by Relay | Stored by Hearth         | Sensitive        |
| -------------------------------------------- | --------------- | ------------------------ | ---------------- |
| Relay application private key                | Yes             | No                       | Yes              |
| Relay application public key/fingerprint     | Yes             | Yes                      | No               |
| Relay TLS/private CA key in managed-TLS mode | Yes             | No                       | Yes              |
| Hearth client private key                    | No              | Yes                      | Yes              |
| Hearth client public key                     | Yes             | Yes                      | No               |
| Outstanding invitation token                 | Hash only       | In pasted URI until used | Yes, temporarily |

Relay therefore stores no reusable **Hearth authentication secret**, but it
does store its own sensitive server keys. Claims that Relay stores no sensitive
material at all would be incorrect.

### Relay identity

On first initialization, Relay generates one persistent application identity
keypair. Its public-key fingerprint becomes the stable Relay ID presented in a
pairing bundle. Relay signs the server authentication transcript on every new
session. Hearth rejects a Relay whose signature does not match the paired
public key.

Changing this key is an identity reset and requires explicit recovery or
re-pairing. Routine TLS certificate renewal must not change it.

### Hearth identity

Hearth generates a new client keypair locally for each Relay pairing. It never
places the private key in a pairing URI or sends it to Relay.

Relay persists the Hearth public key with:

- Client ID
- Display name
- Public key and key fingerprint
- Permissions
- Creation and last-seen timestamps
- Revocation timestamp/reason
- Creating invitation/audit reference

Relay trusts that Hearth after restart by verifying a fresh signature against
this persisted public key, analogous to SSH `authorized_keys`.

### At-rest protection

Relay key and state files must live under `/data`, use restrictive ownership,
and be created with mode `0600` where applicable. State directories should be
`0700`. Secrets must never be included in Sentry payloads, spans, logs, metrics,
command arguments visible outside the container, or error messages.

Hearth should encrypt each client private key using its existing application
keyring with a new, domain-separated purpose such as
`kiln-relay-client-private-key`. Restoring the same Hearth database and keyring
restores the same logical Hearth identity.

Encrypting Relay's unattended private key with a key stored beside it adds no
meaningful protection. A later hardened mode may unlock Relay with a Docker
secret, TPM, or external KMS, but the default should rely on volume isolation
and filesystem permissions.

### Optional source-network restrictions

A key cannot be securely bound to a hostname merely claimed by its client.
Reverse DNS and a `hostname` field in the handshake are not machine identity and
must not be used for authorization.

Relay may support an optional source IP/CIDR constraint on each authorized
Hearth as defense in depth. During pairing, Relay can show the observed source
address and offer **Restrict this Hearth to the current IP**. An exact IPv4 or
IPv6 address becomes a `/32` or `/128`; operators may explicitly configure a
wider CIDR for stable networks.

This is not enabled by default because DHCP, NAT, IPv6 privacy addresses,
proxies, container networks, and horizontally scaled Hearth deployments can
change the observed source. A stale restriction must fail closed with a clear
host-local recovery path.

Relay must use the TCP peer address unless it is explicitly configured with a
trusted proxy. It must never trust arbitrary `X-Forwarded-For` headers. Proxy
Protocol or forwarded addresses may be accepted only from configured proxy
CIDRs, with the resolved source included in the audit record.

The strongest protection against a database-only Hearth breach remains
encrypting the Hearth private key outside the database value. A TPM or KMS-backed
non-exportable Hearth key can later provide genuine machine binding. IP
restrictions reduce risk but do not replace key protection, revocation, or
auditing.

## TLS deployment modes

Hearth can trust a Relay-local CA narrowly for its server-side control socket,
but browser JavaScript cannot add a CA, override certificate validation, or pin
a self-signed certificate for `fetch` or `WebSocket`. Direct browser traffic
therefore requires one of these browser trust paths. The port is irrelevant to
certificate validity: a browser-trusted certificate works on `:4100` exactly as
it does on `:443`.

### 1. Relay-managed TLS

This is the default direct-connect setup for the Hearth control socket and an
available local/private-network setup for browsers.

- Relay generates a local CA and leaf certificate under `/data`.
- The leaf certificate contains the advertised hostname or IP as a SAN.
- The pairing bundle carries the local CA certificate as its narrow trust
  anchor; it never carries a private key.
- Relay renews its leaf certificate under the same local CA without changing
  its application identity.
- Hearth trusts that CA only for this Relay connection, not globally.
- Direct browser features remain unavailable until the operator explicitly
  trusts that Relay CA in the relevant operating-system/browser trust store.

The setup page downloads the public CA certificate already authenticated by
pairing, displays its SHA-256 fingerprint, provides platform-specific install
instructions, and then runs a trust probe against Relay. It never downloads or
exposes the CA private key and cannot install trust silently. The page must
describe that system-wide CA trust is a meaningful security decision. A unique
CA per Relay limits the blast radius compared with sharing one private CA across
all installations.

The normal explicit configuration is:

```text
KILN_RELAY_HOST=relay.example.com
KILN_RELAY_PORT=4100
```

`KILN_RELAY_PORT` defaults to 4100. If `KILN_RELAY_HOST` is absent, Relay may
attempt a short-timeout public-IP lookup through a documented public DNS
resolver, then fall back to a usable operating-system hostname or local address.
This is only a setup suggestion:

- An observed egress IP does not prove that inbound port forwarding works.
- It may expose an origin address the operator intended to hide behind a proxy.
- A container-local address is usually unusable from another node.
- Carrier-grade NAT and split DNS cannot be inferred correctly.

Relay must label an inferred endpoint as unverified, print these warnings, and
ask Hearth to test reachability during setup. The pairing UI and CLI allow the
operator to replace it. Public-IP lookup must be disableable for privacy and
must never block Relay startup.

When a reverse proxy maps a different external port or path, an advanced
`KILN_RELAY_PUBLIC_PORT` or full public URL override may remain available. The
host/port pair is the primary user-facing setup.

### 2. Existing reverse proxy or external TLS certificate

An operator may terminate TLS using Caddy, nginx, Traefik, a load balancer, or
a mounted certificate. A directly mounted, publicly trusted certificate on
Relay's port 4100 is the preferred browser-ready deployment. A reverse-proxy
listener can use 443 or any other port when desired.

- The public certificate is validated through the normal system trust store.
- The proxy must support WebSocket Upgrade and long-lived connections.
- The proxy-to-Relay hop must be loopback, a private container network, or TLS.
- A plaintext backend must never be publicly exposed.
- Relay application signatures still prove the Relay identity after TLS
  termination.

Public ACME automation is an optional Relay certificate mode. DNS-01 can issue
without exposing port 443 but needs a domain and narrowly scoped DNS-provider
credentials; it cannot validate an IP-address certificate. HTTP-01 requires
port 80 and TLS-ALPN-01 requires port 443. Certificate issuance and renewal
ports do not require Relay's application traffic to move away from 4100.

### Certificate ownership and renewal

Relay, not Hearth, owns certificate lifecycle for a direct Relay listener.
Hearth observes certificate status and warns operators, but never receives the
Relay CA private key, ACME account key, DNS credential, or leaf private key.

Renewal behavior depends on the configured TLS mode:

- **Relay private CA:** Relay persists a long-lived local CA and automatically
  renews shorter-lived leaf certificates before their renewal window. Because
  browsers trust the CA rather than one leaf certificate, ordinary leaf
  renewal requires no new browser action or Hearth re-pairing.
- **Relay ACME DNS-01:** Relay stores the ACME account state and protected DNS
  credential under `/data` or reads the credential from a mounted secret. It
  renews automatically, keeps serving the last valid certificate until the new
  chain validates, and never logs DNS credentials or challenges.
- **Mounted certificate or reverse proxy:** the external certificate manager
  renews it. Relay watches mounted certificate/key files, validates that they
  match the advertised name and each other, and atomically reloads them without
  restarting transfers or active sockets.

Renewal begins well before expiry, retries with bounded exponential backoff and
jitter, and emits escalating Hearth/Sentry operational warnings without secret
material. A replacement is written atomically and activated only after its
chain, hostname/IP SAN, key match, validity interval, and minimum remaining
lifetime pass validation. New TLS connections receive the new certificate;
existing WebSockets and downloads may finish on the old connection.

Rotating or losing the private CA is different from renewing a leaf. CA
rotation requires an explicit audited trust transition with old/new fingerprint
display and an overlap period, because every browser that trusted the old CA
must trust the replacement. It still does not rotate Relay's application
identity unless the operator explicitly resets that identity too.

### Browser endpoint and trust confirmation

The pairing contract advertises both the control and browser origins:

```text
control: wss://relay.example.com:4100/v1/socket
browser: https://relay.example.com:4100
```

After pairing, Hearth records its own public browser origin with Relay. Relay
allows only that exact `Origin` for capability issuance targets, WebSocket
upgrades, CORS preflights, and direct HTTP responses. Additional Hearth origins
are learned from their own authenticated pairings; operators do not manually
maintain an IP allowlist. Origin checking is defense in depth and never replaces
capability verification.

The setup UI performs a credential-free request to a minimal CORS-enabled trust
probe. A successful response proves only that the current browser can resolve,
reach, and trust the advertised Relay endpoint. Hearth then issues a one-use
test capability to prove the complete authorization path. Certificate errors
produce a persistent **Relay certificate not trusted by this browser** setup
state with the public-CA or private-CA installation remedies. Direct console
and file controls stay disabled until the probe succeeds; Hearth's control
socket can remain healthy independently.

### Development exception

Plain `ws://` may be allowed only behind an explicit development flag and only
for loopback or a private local container network. Production configuration and
the Hearth UI must reject an unencrypted remote endpoint.

## Relay-owned name

Relay is authoritative for its display name. Hearth stores a cache for fast
rendering, then corrects it from the authenticated Relay snapshot during every
sync. Renaming Relay is a Relay operation and propagates to every paired Hearth.

`KILN_RELAY_NAME` seeds the name only when Relay initializes empty state. If it
is absent, Relay uses the node hostname when one is available and useful. The
last fallback is a persisted, cryptographically random name in the form `K078`
using three uppercase alphanumeric characters. It is generated once, not on
every restart.

The Relay name is presentation metadata, not the cryptographic Relay ID. A
rename never changes keys, trust, endpoints, or instance routing.

## Pairing lifecycle

### Pairing URI

The URI is a versioned bootstrap envelope, not a permanent credential. Its
exact encoding will be defined in the shared contracts package. Conceptually it
contains:

```text
kiln-relay://pair/v1
  ?endpoint=wss%3A%2F%2Frelay.example.com%3A4100%2Fv1%2Fsocket
  &browser=https%3A%2F%2Frelay.example.com%3A4100
  &relay=<relay-id>
  &identity=<relay-public-key-or-fingerprint>
  &trust=<managed-ca-certificate-or-system-pki>
  &invitation=<id>
  &token=<single-use-secret>
  &expires=<timestamp>
```

The final representation may use a base64url-encoded schema rather than query
parameters, but it must remain copyable, QR-friendly, size-bounded, and
forward-versioned.

The control endpoint, browser origin, Relay identity, TLS trust material,
invitation ID, expiry, and token must all be covered by the pairing contract.
Hearth must display the target Relay and fingerprint before the user confirms
setup. Pairing also registers Hearth's current public browser origin with Relay
so direct browser requests can be origin-checked without configuring every
Hearth host or IP on Relay.

### First Relay startup

1. Relay sees that networking state does not exist under `/data`.
2. Relay atomically creates its application identity and TLS state.
3. Relay initializes and persists its name.
4. If no environment bootstrap token is configured, Relay creates a 15-minute,
   single-use full-access invitation.
5. On this first manual initialization only, Relay prints the URI to its
   container log.
6. Relay also renders a terminal QR code when output capability/width supports
   it and emits an OSC 8 clickable link when the terminal supports hyperlinks.
   Plain text is always present as the fallback.
7. The log states the expiry and that anyone possessing the URI before it is
   consumed can pair a Hearth.
8. If the invitation expires unused, the operator runs `pair create` to replace
   it.

If `KILN_RELAY_BOOTSTRAP_TOKEN` is configured, Relay creates only the
environment invitation and logs a redacted **automatic pairing pending** notice
instead. It must not also create or log a second manual invitation.

The first-start log is an explicit usability tradeoff: Docker logs may retain a
bootstrap bearer secret, but it is limited to 15 minutes and one successful
use. The URI must never be sent to Sentry. Relay records that the initial URI
was emitted and never logs it again, including after restarts.

Later CLI- or Hearth-created invitations display their URI and QR code only to
the requesting terminal/UI. Relay's service log may record a redacted notice
with invitation ID, creator, and expiry, but never its token or full URI.

### First Hearth enrollment

1. User selects **Add Relay** and pastes the URI.
2. Hearth validates the URI schema, version, endpoint, and expiry locally.
3. Hearth shows the endpoint and Relay fingerprint for confirmation.
4. Hearth generates a unique Ed25519 keypair for this Relay.
5. Hearth opens WSS using the supplied narrow TLS trust anchor or system PKI.
6. Hearth verifies Relay's signed server hello against the identity in the URI.
7. Hearth submits the invitation ID, token, proposed client public key, client
   name, and proof of possession of the new private key.
8. Relay hashes and constant-time compares the token, verifies expiry and
   single-use state, and verifies the proof of possession.
9. Relay commits the new authorized client and consumes the invitation in one
   atomic state transaction.
10. Relay returns the client ID and granted permissions.
11. Hearth encrypts and persists its private key only after successful
    enrollment, then transitions to synchronization.
12. Hearth tests the browser endpoint. Publicly trusted TLS completes without
    user action; Relay-managed private TLS enters the explicit CA trust flow
    before direct streaming and transfer features are enabled.

The first successfully enrolled Hearth receives the `full_access` Relay client
role.

### One-time environment bootstrap

Colocated Compose deployments may perform the same enrollment automatically
without copying a URI. This is a second **bootstrap input**, not a second
connection or authentication system.

Relay and Hearth receive the same high-entropy one-time value, endpoint host,
and port through their respective container environments:

```text
KILN_RELAY_HOST=relay
KILN_RELAY_PORT=4100
KILN_RELAY_BOOTSTRAP_TOKEN=<at-least-32-random-bytes>
```

An optional `KILN_RELAY_BOOTSTRAP_TOKEN_FILE` should support Docker secrets,
but the environment value remains supported for a simple single Compose file.

The automatic flow is:

1. Relay has empty networking state and imports only the hash of the bootstrap
   token as a 15-minute, one-use full-access invitation. The raw value remains
   in process memory only while bootstrap is pending.
2. Hearth has no configured Relay, detects the bootstrap variables, and
   generates a unique client keypair exactly as the pasted-URI flow does.
3. Hearth connects to `wss://<host>:<port>/v1/socket`.
4. With a publicly trusted or preconfigured TLS certificate, ordinary TLS
   validation applies immediately.
5. With a newly generated Relay-managed certificate, a dedicated bootstrap
   verifier uses HMAC-SHA-256 and the high-entropy token to authenticate a
   domain-separated transcript containing both nonces, the exact presented TLS
   certificate fingerprint, Relay application public key, endpoint, protocol
   version, invitation ID, and expiry. The token itself is never sent.
6. Hearth sends no enrollment key or privileged data until that proof and the
   presented certificate binding are valid. Relay also verifies Hearth's proof
   of token possession and proof of possession of its new client private key.
7. Relay atomically stores Hearth's public key, consumes the invitation, and
   discards its in-memory bootstrap token.
8. Hearth persists Relay's TLS trust anchor, Relay identity, and encrypted
   client private key, closes the provisional bootstrap session, and reconnects
   through the normal strict WSS authentication path.

The bootstrap verifier must be isolated from the normal connection dialer. It
is not a general `rejectUnauthorized=false` option and must fail closed before
any secret or enrollment mutation is sent. Its transcript and threat model need
independent review and golden test vectors before implementation.

Both sides ignore the bootstrap variables after durable pairing state exists.
Leaving the value in Compose cannot create another Hearth, although removing it
after setup is recommended. Resetting only Hearth or only Relay data must not
silently reuse the old environment token; identity loss requires an explicit
new invitation or recovery operation.

After enrollment, environment-paired and URI-paired connections are identical:
unique keypair, Relay public-key registry, permissions, signed challenge
response, WSS transport, reconnection, and revocation.

### Adding another Hearth

The primary workflow is explicit authorization by an existing full-access
Hearth:

1. An authorized user opens Relay settings in the authenticated Hearth.
2. They select **Create pairing invitation** and choose a name and initial
   permission set.
3. Hearth sends `pairing.create` over its authenticated WebSocket.
4. Relay returns a new 15-minute, one-use URI exactly once.
5. The URI is pasted into the new Hearth, which generates its own keypair.

Relay should allow only a small number of outstanding invitations, rate-limit
creation and enrollment attempts, and support listing and revoking pending
invitations without ever returning their tokens again.

### Host-level recovery

If no authorized Hearth is available, access to the Relay host is the recovery
authority:

```bash
docker exec kiln-relay kiln-relay pair create \
  --url wss://relay.example.com:4100/v1/socket
docker exec kiln-relay kiln-relay pair list
docker exec kiln-relay kiln-relay pair revoke <invitation-id>
docker exec kiln-relay kiln-relay hearth list
docker exec kiln-relay kiln-relay hearth revoke <client-id>
```

The runtime image is currently distroless, so the executable/CLI must be
implemented as a supported Relay entry point rather than relying on a shell.
The final Docker invocation may need to call the Node entry directly or provide
a dedicated binary wrapper.

### Normal authentication after restart

1. Hearth opens WSS and requests subprotocol `kiln-relay.v1`.
2. Relay returns its ID, a new session ID, expiry, secure random nonce, and a
   signature over the complete server transcript.
3. Hearth verifies the Relay signature using its pinned Relay public key.
4. Hearth signs a domain-separated byte transcript containing at least:
   - Protocol identifier and version
   - Relay ID
   - Hearth client ID
   - Session ID
   - Server nonce
   - Challenge expiry
5. Relay verifies the signature using the stored Hearth public key and checks
   that the client is not revoked.
6. Both sides derive no new long-term shared secret; WSS protects the live
   session.
7. Relay marks the session authenticated and sends the initial snapshot.

Challenges are bound to one connection, expire quickly, and are consumed once.
A captured signature cannot authenticate a later connection.

## Authorization and multi-Hearth safety

Relay is the final authorization boundary for privileged node operations.
Hearth's user authorization remains necessary but does not replace Relay client
authorization.

These are two separate layers:

- Hearth user permissions decide what a signed-in person may ask their Hearth
  to do.
- Relay client permissions decide what that entire Hearth installation may ask
  the node to do.

The effective permission is their intersection. Relay always enforces its own
decision even if a modified Hearth sends a request that its UI should have
blocked.

### Built-in Relay client roles

- `full_access`: every registered Relay operation. This is the default for the
  initial Hearth and for every newly created Hearth invitation.
- `read_only`: can inspect Relay, Brick, instance, networking, console, log, and
  file information, but cannot create/delete instances, change power state,
  send console commands, mutate networking, or create/edit/delete files.

The pairing UI may let the creator choose `read_only`, but defaults visibly to
`full_access` as requested. Future custom roles can store explicit action keys.

### Action registry

Every protocol operation declares one stable action key in a centralized,
schema-validated registry. Authorization is deny-by-default, occurs before the
handler starts, and is also checked for long-running subscriptions when
permissions change.

Initial action-key direction:

```text
relay.read
relay.rename
relay.configure
relay.audit.read
relay.pairing.create
relay.pairing.list
relay.pairing.revoke
relay.clients.list
relay.clients.update
relay.clients.revoke

brick.read

instance.read
instance.create
instance.delete
instance.rename
instance.power.start
instance.power.stop
instance.power.restart
instance.power.kill
instance.console.read
instance.console.write
instance.sftp.connect
instance.files.list
instance.files.read
instance.files.create
instance.files.write
instance.files.delete
instance.files.rename
instance.files.chmod
instance.files.download
instance.files.upload
instance.network.read
instance.network.write
instance.logs.read
```

Keep keys granular even when the first built-in roles group them together.
Adding `instance.power.suspend`, for example, does not require redesigning the
authorization model.

Do not perform wildcard string matching such as trusting every
`instance.power.*` sent by a client. The protocol registry owns the complete set
of valid actions. `full_access` means all actions known to that Relay build;
`read_only` is generated only from actions explicitly classified and reviewed
as non-mutating. A future custom role receives no new actions automatically.

Relay advertises the resolved granted action set after authentication so Hearth
can reuse its existing permission gates for disabled/hidden controls. This is a
behavioral constraint, not a redesign of existing pages. Permission changes and
revocations update active sessions immediately.

Every mutating request includes a unique request ID and authenticated client
ID. Relay records which Hearth issued the action. Operations that can safely be
retried must have explicit idempotency semantics. Concurrent conflicting
actions return a typed conflict instead of relying on arrival timing.

Examples:

- Duplicate `instance.start` with the same request ID returns the original
  result.
- Start and stop for the same instance are serialized per instance.
- File writes use an expected revision/hash to prevent silent overwrites.
- Client revocation closes every active session for that client.

### Direct browser capabilities

A direct capability is a signed authorization artifact, not a browser session
and not a copy of the Hearth–Relay credential. Its versioned claims include at
least:

- Issuer Hearth client ID, Relay ID, user ID, and instance ID
- One registered action and the narrow resource scope needed by that action
- Issued-at, not-before, and short expiry timestamps
- A cryptographically random `jti` for replay control
- The exact allowed browser origin
- A thumbprint of an ephemeral, non-exportable browser WebCrypto public key
- Optional relative path, maximum bytes, expected revision, and transfer ID

Relay validates the signature, time window, target Relay/instance, origin,
browser-key proof, replay policy, current issuer-client status, and current
action grant. User permission changes stop new issuance immediately; sensitive
revocation also closes matching live browser sessions and invalidates
outstanding JTIs.

WebSocket capabilities are sent in the first authentication frame rather than
the URL so they do not leak through proxy request logs or browser history.
Uploads use an `Authorization` header. Every direct request also proves
possession of the browser key over the method, endpoint, capability JTI,
timestamp, and a Relay nonce. A copied capability is therefore insufficient
from another browser or command-line client.

### Sensitive download authorization

TLS answers **is this the expected Relay?** It does not answer **may this user
download this file?** That authorization is a separate end-to-end ceremony:

1. Hearth authenticates the user's normal session, validates CSRF/user intent,
   and checks the exact instance/file download permission.
2. The browser creates or reuses an in-memory, non-exportable WebCrypto key for
   the signed-in session and gives Hearth only its public-key thumbprint.
3. Hearth signs a capability bound to that key, Relay, user, instance,
   canonical relative path, file revision, byte/range ceiling, origin, short
   expiry, and one-use JTI.
4. Browser and Relay complete a nonce-based proof-of-possession exchange. Relay
   validates Hearth's signature, the browser signature, the registered origin,
   the paired Hearth's current grants, and all file claims before opening the
   file.
5. Relay atomically consumes the JTI when the transfer session begins. A
   bounded transfer-session ID permits only the authorized Range/resume window
   until its total expiry; it cannot select another path or grow its byte scope.

For native download-manager streaming without putting a bearer secret in a
URL, the leading candidate is a user-initiated cross-origin `POST` form.
JavaScript signs the proof, places the capability and proof in the POST body,
and submits to Relay, which returns `Content-Disposition: attachment`. This
must be validated across supported browsers during the implementation spike.
The fallback, if a browser cannot support that flow, is an explicitly weaker
one-use URL with a very short expiry, strict referrer policy, no-store headers,
and complete log/Sentry redaction; it must not be the default for sensitive
files.

Origin checks alone are not treated as browser authentication because
non-browser clients can forge an `Origin` header. Proof-of-possession prevents
capability theft outside the browser session, but it cannot protect against
malicious code already executing in Hearth's origin; CSP, dependency hygiene,
session security, and XSS prevention remain part of the trust boundary.

## WebSocket protocol

### Version negotiation

- Hearth control endpoint: `/v1/socket`, subprotocol `kiln-relay.v1`
- Browser stream endpoint: `/v1/browser`, subprotocol
  `kiln-relay-browser.v1`
- Reject missing or unsupported subprotocols during Upgrade.
- Protocol-breaking changes receive a new subprotocol version.
- Hearth and Relay advertise build/protocol compatibility after authentication.

### Message contract

All control frames are schema-decoded at the boundary. Reusable protocol models
belong in `@workspace/contracts` and should use Effect Schema when this
transport is implemented. Unknown input must never be trusted through a type
assertion.

Conceptual envelope:

```json
{
  "v": 1,
  "type": "request | response | event | error | stream",
  "id": "message-id",
  "replyTo": "request-id-or-null",
  "stream": "stream-id-or-null",
  "seq": 42,
  "payload": {}
}
```

The final envelope should avoid fields that do not apply to a message by using
a tagged union rather than one loose object. Start with JSON for debuggability.
Only adopt a binary encoding after profiling proves serialization is material.

### Request/response operations

Every control-plane operation maps to a typed request and response:

- Node/instance snapshot
- Brick catalog and recipe
- Instance create/delete/action
- Networking configuration
- File tree, metadata, and small editor read/write
- Console history/completion and capability issuance support
- Relay-initiated SFTP authentication and permission resolution over the
  already-established bidirectional control session
- Latest log
- Pairing/client administration

Requests have deadlines. Relay cancels work when possible after a deadline,
session close, or explicit cancellation. Errors are tagged, typed protocol
values; stack traces and internal paths never cross the boundary.

### Server-pushed events

After authentication, Relay sends a full versioned snapshot followed by
ordered deltas:

- Node metrics
- Instance lifecycle/status
- Instance inventory changes
- Relay configuration changes
- Permission/revocation changes
- SFTP user/instance permission invalidation
- Console lines for subscribed instances

Each ordered stream carries a monotonically increasing sequence. If Hearth
detects a gap, it requests a fresh snapshot instead of guessing state.
Reconnect always begins with synchronization unless a future bounded resume
window can prove continuity.

### Subscriptions

Console and other high-volume browser data use explicit direct subscriptions on
`/v1/browser`. Each subscription has an ID and is cleaned up automatically when
its owning browser session closes. Hearth may still subscribe over the control
socket for server-side jobs or non-browser consumers, but it is not the normal
interactive data path.

Relay should gather shared node metrics once per interval and fan out the same
immutable snapshot. It must not repeat Docker inspection separately for every
Hearth.

### Console fan-out

Five users viewing the same console produce five direct browser sockets but
only one underlying Docker log tail:

```text
                         ┌─→ Browser 1
                         ├─→ Browser 2
Docker log source ─1x→ Relay console topic ─→ Browser 3
                         ├─→ Browser 4
                         └─→ Browser 5
```

The replacement uses a reference-counted Relay hub:

1. Relay maintains at most one underlying Docker console tail per instance,
   regardless of how many browsers or Hearth sessions subscribe.
2. The first authorized viewer starts the Docker tail; later viewers attach to
   the existing immutable/batched topic.
3. The last subscriber leaving stops the tail after a short grace period to
   avoid churn during navigation or refresh.
4. Every browser receives an independent bounded queue. A slow browser can lose
   old console lines and resynchronize without slowing Docker, Relay, or other
   viewers.
5. Relay re-checks capability expiry and current grants during long sessions;
   expiry requires a silent capability refresh through Hearth.

Source work is O(1) per viewed instance and outbound delivery is O(viewers),
which is unavoidable because every browser must receive the bytes. Hearth no
longer pays the bandwidth, parsing, memory, or replica-coordination cost for the
hot stream. Relay should parse and batch a line once and share the encoded batch
where practical.

This fan-out is transport-internal. The existing console screen, filters,
scroll behavior, and commands should not visually change.

### Backpressure

Every client gets bounded outbound queues separated by delivery class:

| Class                                         | Policy                                                                |
| --------------------------------------------- | --------------------------------------------------------------------- |
| Responses, command results, auth, permissions | Never silently drop; disconnect a persistently stalled client         |
| Lifecycle and inventory events                | Preserve order; force resync if the queue cannot retain continuity    |
| Metrics                                       | Latest value wins; coalesce stale samples                             |
| Console output                                | Bounded buffer; report a sequence gap and require history/resubscribe |
| File transfers                                | HTTP backpressure, bandwidth limits, and bounded disk buffers         |

One slow browser or Hearth must never block another. Queue size, buffered bytes,
send latency, coalesced events, dropped stream records, and forced resyncs
should be observable.

### Files

Large file bytes travel directly between browser and Relay over streaming HTTPS
on port 4100, not through Hearth and not inside WebSocket frames.

Downloads support `HEAD`, `GET`, HTTP Range/resume, `Content-Length`, safe
`Content-Disposition`, an ETag/revision, cancellation, bandwidth limits, and
`Cache-Control: no-store`. Relay validates the capability and relative path
before opening the file and streams disk-to-response with bounded buffers.

Uploads use `PUT` or multipart streaming with a capability-bound relative path,
declared and enforced maximum size, quota check, content hash, expected file
revision, timeout, cancellation, and progress. Relay writes to an instance-local
temporary file and atomically renames only after all validations pass. It never
buffers a whole upload in Relay or Hearth memory.

Directory listing, rename, delete, permissions, and small editor operations
remain browser-to-Hearth-to-Relay control calls. Both paths must share one
canonical Relay filesystem boundary for path containment, symlink handling,
quota, revisions, permissions, and audit; direct transfer routes are not a
second authorization implementation.

### Liveness and reconnect

- Use WebSocket Ping/Pong for transport liveness.
- Mark a session unhealthy after missed heartbeats within a defined deadline.
- Hearth reconnects with exponential backoff and full jitter, capped around 30
  seconds.
- Successful stability resets the backoff.
- Authentication failures do not retry aggressively; revoked/invalid identity
  requires operator action.
- Reconnect creates a new authenticated session and refreshes the snapshot.
- Do not persist or reuse live session tokens in the first version.

## Connection and offline UX

Hearth exposes one authoritative Relay connection state to server functions and
the UI:

```text
unconfigured
  → connecting
  → authenticating
  → synchronizing
  → ready
  → reconnecting
  → ready

invalid_identity | revoked | incompatible | offline
```

The UI distinguishes browser connectivity from Relay connectivity:

- Browser cannot reach Hearth: **You're offline**
- Hearth is available but Relay is reconnecting: **Unable to connect to L01**
- Hearth can reach Relay but this browser cannot reach it: **Unable to reach
  L01 directly** with proxy, DNS, firewall, and port guidance
- Browser rejects Relay's certificate: **Relay certificate not trusted by this
  browser** with a setup action, never a generic offline message
- Authentication was revoked or identity changed: persistent action-required
  message, not an endless retry toast
- Connection restored: dismiss the persistent warning and optionally show one
  short recovery confirmation

Toasts must be deduplicated and should not fire once per failed request. Relay
session state is the source of truth. Cached snapshots may render as stale with
an explicit timestamp, but mutating actions remain disabled until the session
is ready.

Browser offline listeners and React Query network state should update a small
external connection store so connectivity changes do not repaint unrelated
workspace components.

### UI compatibility boundary

New setup, pairing, browser trust, Relay-client role, source restriction, and
revocation controls belong on the Relay setup/settings surface. Outside that
surface:

- Preserve existing routes, layouts, labels, console behavior, file browser,
  instance controls, and visual hierarchy.
- Treat the transport migration, direct capability refresh, and console fan-out
  as invisible plumbing.
- Reuse existing permission-aware disabled/hidden control patterns when a
  Relay's client role is read-only.
- Add only the previously planned offline/reconnecting/action-required status
  messaging necessary to represent real connection state.
- Verify with browser screenshots and render profiling that connection updates
  do not repaint unrelated workspaces.

## Persistence plan

Relay needs durable, transactional state for:

- Relay identity metadata
- Relay TLS CA/leaf or ACME account metadata and certificate renewal state
- Relay SFTP host identity and, after the development scaffold, SFTP credential
  verifiers/key registrations
- Relay-owned display name
- Authorized Hearth clients
- Client role, explicit action grants, and optional source CIDRs
- Outstanding invitation hashes
- Revocations and permission changes
- Protocol/state schema version
- A bounded security audit log

Use a small local SQLite database under `/data/network/` with migrations,
transactions, restrictive permissions, and no network listener. The current
Node 24 runtime provides a path to SQLite without running a database service;
the implementation spike must confirm the selected driver works in the
distroless image before committing to it. If it does not, choose a packaged
SQLite driver rather than weakening atomic enrollment/revocation semantics.

Keep private key files outside database rows so file permissions, rotation, and
optional secret-provider integrations remain straightforward. Write all key
files atomically and `fsync` before reporting successful initialization.

Hearth's existing Relay table will migrate from bearer-token endpoint fields to
connection identity fields, including:

- Relay stable ID and application public key/fingerprint
- Cached Relay name and last synchronized revision
- WSS endpoint and TLS trust mode/material
- Browser HTTPS origin, registered Hearth origins, and last trust-probe status
- Hearth client ID
- Encrypted Hearth client private key
- Resolved Relay-client actions for local UI gating
- Protocol version and connection metadata

Hearth's cached name is not independently editable state. Relay remains the
source of truth and overwrites the cache during synchronization.

The legacy `token_ciphertext` and `KILN_RELAY_KEY` paths are removed after the
WebSocket cutover.

## Effect implementation shape

This is lifecycle-heavy, concurrent infrastructure and should become scoped
Effect services rather than adding more global maps to Relay's entry point.

Proposed service boundaries:

- `RelayIdentity`: initialize/load Relay keys and sign authentication transcripts
- `RelayStateStore`: transactional clients, invitations, permissions, and audit
- `RelayTls`: construct managed or externally supplied TLS listener state
- `RelayCertificateManager`: renew, validate, atomically activate, and report
  direct-listener certificates
- `RelayBootstrap`: manual-URI and one-time environment enrollment boundaries
- `PairingService`: create, consume, expire, and revoke invitations
- `RelayActions`: centralized action registry, role expansion, and authorization
- `RelaySession`: one scoped authenticated Hearth connection
- `BrowserSession`: one scoped capability-authenticated browser stream
- `RelayHub`: own active sessions and broadcast shared events
- `RelayConsoleHub`: reference-count Docker tails and fan out bounded batches
- `TransferCapability`: issue/verify scoped capabilities and enforce replay rules
- `InstanceFilesystem`: the single guarded filesystem boundary used by control
  operations and direct transfers
- `RelayTransfer`: stream direct HTTP uploads/downloads with bounded buffers
- `SftpHostIdentity`: initialize/load the persistent SSH host key and expose its
  fingerprint
- `SftpAuthentication`: authenticate a user through the authoritative Hearth
  and resolve the per-instance action map
- `SftpVirtualRoot`: route synthetic instance directories to authorized
  `InstanceFilesystem` handles without path/string concatenation
- `SftpSession`: own one subsystem-only connection, operation checks, quotas,
  and interruption
- `RelayProtocol`: decode, authorize, route, and encode messages
- `RelayTelemetry`: protocol-safe logs, spans, metrics, and redaction
- Hearth `RelayConnection`: one scoped reconnecting client per configured Relay
- Hearth `DirectRelayClient`: acquire/refresh capabilities without causing
  component-local sockets or broad React updates

Build implementations as Layers and provide them at the Relay/Hearth runtime
boundary. Each accepted socket runs in its own Scope; disconnect interruption
must close subscriptions, Docker streams, queues, and child fibers. Use Effect
queues, streams, schedules, and fiber supervision for bounded fan-out and
cleanup. Define expected failures with `Schema.TaggedErrorClass` and reserve
defects for actual invariant violations.

Connection managers must be shared per Relay configuration. React components
and individual server functions must not each create their own socket.

Effect `Scope` finalizers own WebSockets, HTTP transfers, SFTP listeners and
sessions, and console subscriptions. `PubSub` or
the equivalent bounded broadcast primitive should carry immutable console/event
batches, while per-subscriber queues enforce independent backpressure. The
first/last subscriber transition is serialized so concurrent browser connects
cannot create duplicate Docker streams.

Effect's WebSocket APIs are currently under unstable platform/socket modules,
so the implementation should wrap the chosen API behind Kiln-owned service
interfaces and confirm exact APIs against the vendored Effect source. This
contains upgrade churn without patching Effect itself.

## Observability and redaction

Keep Sentry initialized at each process boundary before networking layers are
built. Effect services and reusable operations should use named `Effect.fn`
spans, with Layer acquisition/release covering listeners, state stores, socket
sessions, reconnect loops, Docker tails, console hubs, certificate renewal, and
SFTP sessions. Expected disconnects and typed authentication failures are
recorded as outcomes/metrics rather than reported as unhandled exceptions.

Record:

- Active sessions by Relay/client ID, never by secrets
- Connect/auth/sync duration
- Authentication rejection reason as a bounded tag
- Reconnect count and backoff
- Request latency by normalized operation
- Queue depth and buffered bytes by delivery class
- Console source count, Relay subscription count, local viewer count, and fan-out
  batch size
- Resync and sequence-gap counts
- Ping/Pong latency
- Direct browser sessions, capability rejection reason, and refresh count
- Transfer duration, bounded status, and bytes sent/received
- Certificate mode, remaining lifetime bucket, renewal outcome, and reload
  outcome
- SFTP session/auth outcome, active-session count, operation category, and byte
  count

Create spans for connection, authentication, synchronization, capability
issuance/verification, request handling, file transfer, certificate renewal,
and SFTP authentication/operations. Do not attach raw frames, console content,
file content, SFTP passwords, pairing URIs, tokens, public URLs containing
secrets, private keys, or full signatures to Sentry. User emails and file paths
must not be high-cardinality tags; secure audit records may retain the minimum
path/user detail required for accountability under the product's retention
policy.

The intentionally emitted first-start pairing URI is a console-only exception.
It must bypass structured telemetry and Sentry breadcrumbs entirely. Later
pairing operations log only redacted metadata.

Security-sensitive audit events include:

- Invitation created, expired, consumed, or revoked
- Client paired, renamed, permission-changed, key-rotated, or revoked
- Authentication rejected
- Relay identity reset
- Certificate renewal/rotation failure and SFTP host-key rotation
- SFTP login, logout, denial, and file mutation
- Privileged instance/file actions

Audit records identify the authenticated Hearth client and request ID.

## Migration and delivery plan

Legacy compatibility is intentionally not required, but each phase should end
in a reviewable, testable checkpoint.

### Phase 0 — Protocol and threat-model review

- Finalize this document's open questions.
- Define attacker capabilities and trust/recovery boundaries.
- Threat-model browser capability theft, SSH/SFTP parser exposure, virtual-root
  path escape, cross-instance access, and ambiguous multi-Hearth users.
- Confirm cryptographic formats with Node's supported APIs.
- Define versioned pairing and frame schemas in `@workspace/contracts`.
- Create golden encoded fixtures for protocol compatibility.

**Gate:** malformed, replayed, expired, downgraded, and cross-Relay
authentication cases have explicit expected outcomes.

### Phase 1 — Relay identity, persistence, and local pairing CLI

- Add durable Relay state migrations.
- Generate/load Relay application identity atomically.
- Initialize the Relay-owned name from `KILN_RELAY_NAME`, hostname, or the
  random fallback.
- Add managed TLS initialization, certificate renewal/reload, external
  certificate loading, browser origin, and advertised URL validation.
- Generate/load the persistent SFTP SSH host key and surface its fingerprint.
- Implement invitation creation, hashing, expiry, consumption, and revocation.
- Implement the environment bootstrap transcript and ensure it cannot affect an
  initialized Relay.
- Implement the distroless-compatible `pair` and `hearth` administrative entry
  points.
- Render the first-start URI, clickable link, and supported-terminal QR without
  forwarding the secret into Sentry.
- Ensure secrets are redacted from logs and Sentry.

**Gate:** restarting Relay preserves identity and authorized public keys;
concurrent enrollment attempts can consume an invitation only once.

### Phase 2 — Authenticated control WebSocket foundation

- Add the configurable WSS listener and protocol negotiation.
- Implement signed Relay hello and Hearth challenge response.
- Add scoped session lifecycle, limits, heartbeat, backpressure, and shutdown.
- Support multiple independently authenticated clients.
- Add centralized action authorization, `full_access`, `read_only`, and optional
  source CIDR enforcement.
- Implement revocation that terminates live sessions.

**Gate:** two different Hearth test clients can connect concurrently, restart,
re-authenticate, and be revoked independently.

### Phase 3 — Hearth connection manager and Relay setup UI

- Add pairing URI parsing and confirmation UI.
- Add zero-touch environment initialization when Hearth has no Relay state.
- Generate a unique keypair per Hearth–Relay pairing.
- Encrypt the Hearth private key with the existing keyring.
- Replace token/HTTP Relay configuration with endpoint, trust, and identity
  fields.
- Register Hearth's browser origin, add the Relay trust probe, and provide the
  explicit private-CA download/fingerprint/install flow.
- Display certificate mode, expiration/renewal health, and the SFTP host-key
  fingerprint without exposing private material.
- Add a single shared scoped connection manager per Relay.
- Add additional-Hearth invitation UI and client/revocation management.
- Move Relay naming to Relay-owned state and synchronize Hearth's cache.

**Gate:** first setup and additional-Hearth setup work from fresh containers,
publicly trusted and explicitly installed private-CA browsers pass the trust
probe on port 4100, and both sides survive restart.

### Phase 4 — Read models, direct capabilities, and push updates

- Move snapshot, node metrics, instance inventory, and lifecycle state to the
  WebSocket protocol.
- Send one initial snapshot followed by ordered deltas.
- Replace connected polling with pushed state.
- Keep bounded cached snapshots for disconnected display.
- Add short-lived, signed, origin-bound direct capabilities and the
  capability-authenticated `/v1/browser` endpoint.
- Bind sensitive transfer capabilities to ephemeral non-exportable browser
  keys and implement nonce-based proof-of-possession.
- Move interactive resource/status streams directly to the browser while
  keeping Hearth's synchronized control-plane snapshot.

**Gate:** no steady-state snapshot polling remains while the socket is ready;
sequence gaps and reconnects produce a correct resync.

### Phase 5 — Commands, direct console/files, and SFTP

- Move every Relay request/response operation to multiplexed protocol messages.
- Replace per-browser Relay NDJSON proxying with direct browser WSS backed by
  one reference-counted Relay Docker tail per instance.
- Add direct HTTPS uploads/downloads on port 4100 with Range/resume, bounded
  streaming, revisions, hashes, quotas, and atomic upload commit.
- Keep file metadata/tree/editor operations on the control plane and require
  both paths to share the guarded `InstanceFilesystem` service.
- Add the subsystem-only SFTP listener on configurable port 2022, the synthetic
  multi-instance virtual root, per-operation action enforcement, quotas,
  bounded sessions, rate limits, and audit.
- Add the explicitly development-only email/`dev123` authenticator. Refuse to
  start it in production and reject ambiguous users across paired Hearths.
- Add idempotency and per-instance mutation serialization.
- Remove legacy authenticated control HTTP routes after parity is verified;
  retain only the new capability-authenticated direct transfer routes.

**Gate:** legacy authenticated control HTTP routes are disabled; five viewers
use five bounded direct deliveries and one underlying Docker tail; file bytes
do not transit Hearth; one SFTP user sees exactly their authorized instance
directories and cannot request a shell or escape/cross the virtual roots.

### Phase 6 — Offline UX and operational hardening

- Drive UI state from the shared Relay connection manager.
- Add distinct browser-offline, Relay-reconnecting, and identity-error states.
- Deduplicate disconnect notifications and avoid broad React repainting.
- Add production metrics, rate limits, capacity limits, and security audit UI.
- Replace development SFTP authentication with separate generated Argon2id
  SFTP credentials and optional public keys before any production enablement.
- Instrument connection, authorization, capability, direct transfer,
  subscription fan-out, and reconnect lifecycles with Effect spans and redacted
  Sentry telemetry.
- Validate direct 4100, non-default port, reverse proxy, certificate renewal,
  IPv4, and IPv6 deployments.

**Gate:** network interruption, Relay restart, Hearth restart, TLS renewal,
SFTP permission revocation, and slow-client simulations recover predictably
without stale controls. The `dev123` authenticator cannot start in a production
build/configuration.

### Phase 7 — Legacy removal and documentation

- Remove bearer token authorization and `KILN_RELAY_KEY`.
- Remove Hearth's legacy HTTP Relay client and `use_tls` boolean model.
- Replace legacy `KILN_RELAY_URL` initialization with host/port and one-time
  bootstrap token variables.
- Update Docker Compose, example environment, setup guide, backup guide, and
  recovery procedures, including the separate 2022 SFTP port and host-key
  verification.
- Require explicit re-pairing for existing installations.

**Gate:** a clean install requires Docker, `/data`, Docker socket, a chosen
port, and an explicit browser trust choice; an explicit host is recommended,
endpoint inference warns when it cannot prove reachability, and migration
instructions are complete.

## Verification matrix

### Security

- Expired, reused, revoked, malformed, and guessed invitations fail.
- Environment bootstrap cannot run after either side has durable pairing state
  and never degrades the normal TLS verifier.
- One invitation cannot enroll two clients under concurrency.
- A Hearth key paired to Relay A cannot authenticate to Relay B.
- A signature captured from one session cannot authenticate another.
- Relay identity mismatch fails closed with a clear operator action.
- TLS downgrade, unsupported subprotocol, oversized frame, and invalid schema
  fail before privileged routing.
- Revocation closes active sessions and rejects reconnects.
- Every protocol operation is denied without its registered action key.
- `read_only` cannot mutate state through direct protocol calls.
- A direct capability cannot be replayed for another Relay, Hearth origin,
  user, instance, action, path, or transfer size.
- Expired/revoked capabilities close or deny direct browser work, and no
  long-term Hearth private key reaches a browser.
- A stolen capability without the non-exportable browser key cannot open or
  resume a sensitive download; a consumed JTI cannot start a second transfer.
- Optional source CIDRs use only the TCP peer or explicitly trusted proxy data.
- Pairing tokens and private keys never appear in logs or Sentry fixtures.
- File paths, sizes, quotas, revisions, ranges, and hashes remain enforced at
  Relay through the shared filesystem boundary.
- SFTP accepts only the SFTP subsystem; shell/exec/PTY/forwarding/SCP fail.
- SFTP root listing exposes only authorized instances, and path traversal,
  symlink races, cross-instance rename, and ambiguous Hearth/email identities
  fail closed.
- `dev123` authentication is impossible in production mode and never appears in
  logs, telemetry, generated examples, or production fixtures.

### Reliability

- Relay and Hearth can restart independently.
- Leaf TLS certificate renewal does not require re-pairing.
- Managed leaf and ACME renewal happen before expiry, survive failed attempts,
  atomically reload, and preserve the last valid certificate.
- Reconnect uses bounded jittered backoff and resynchronizes state.
- Missed event sequences force a snapshot.
- A slow or disconnected Hearth does not delay another Hearth.
- Shutdown interrupts control/browser sockets, console streams, HTTP transfers,
  SFTP sessions, queues, and fibers.
- SFTP permission/user revocation terminates affected live sessions; an
  unavailable authoritative Hearth denies new development-scaffold logins.
- An interrupted key/state write leaves the previous valid state intact.

### Performance

- Relay gathers shared metrics once and fans them out.
- One instance console has one Docker tail regardless of Hearth/viewer count.
- Five viewers create five bounded direct browser deliveries and one Docker
  tail; Hearth carries none of the console payload.
- Idle connections have negligible traffic beyond heartbeats.
- Metrics are coalesced rather than queued without bound.
- Console and direct HTTP file throughput respect explicit byte budgets.
- Concurrent SFTP sessions use bounded memory/file descriptors and do not
  duplicate instance filesystem watchers or bypass disk quotas.
- UI connection-state changes do not repaint unrelated screens.
- Compare CPU, allocations, bandwidth, and update latency against current
  polling/NDJSON behavior before removing the fallback implementation.

### Deployment

- Direct managed WSS/HTTPS on 4100 after explicit browser CA trust.
- Direct managed WSS/HTTPS on a non-default port after explicit browser CA
  trust.
- Publicly trusted certificate serving WSS/HTTPS on a non-443 port.
- Reverse proxy sharing 443 with a website.
- Private Docker network backend with public proxy frontend.
- One-time environment bootstrap in a shared Compose deployment.
- Host/port configuration, public-IP inference warning, and manual correction.
- DNS name, IPv4 literal, and IPv6 literal SAN handling.
- Browser trust failure, CA installation, origin rejection, trust-probe retry,
  and certificate renewal.
- Relay-private-CA leaf renewal, ACME DNS-01 renewal, mounted certificate
  hot-reload, expiry-warning, and explicit CA-rotation paths.
- SFTP on the default 2022 and a non-default port, including host-key
  persistence/verification and multiple authorized instance directories.
- Backup/restore with identity retained and intentional identity reset.

Prefer a small set of deterministic protocol/crypto/persistence tests plus
browser validation of setup and offline UX. Crypto transcript fixtures,
invitation atomicity, replay rejection, schema decoding, and migration behavior
are critical enough for automated coverage.

## Operational recovery

- Backing up `/data` preserves Relay identity and trusted Hearth public keys.
- Backing up Hearth's database without its application keyring does not preserve
  usable client private keys.
- Losing a Hearth private key requires revoking that client and pairing a new
  one.
- Losing Relay state creates a new Relay identity; Hearth must visibly reject
  it until the operator confirms recovery/re-pairing.
- A retained environment bootstrap token never repairs a one-sided state loss;
  recovery requires an explicit new invitation.
- Suspected Hearth compromise requires revoking only that client identity.
- Suspected Relay identity compromise requires rotating/resetting Relay
  identity and re-pairing every Hearth.
- There must always be a host-local recovery path even when every Hearth client
  is revoked or offline.

## Open questions for audit

1. Should an authorized Hearth be allowed more than one simultaneous session
   by default, or should extra sessions require an explicit deployment setting?
2. How much security audit history should Relay retain in its bounded local
   store?
3. Should source restriction support only literal IP/CIDR values initially, or
   also an explicitly resolved DNS policy with its additional failure modes?
4. Which public DNS resolver should endpoint inference use, and should operators
   have to opt in before the first external lookup?
5. Does the HMAC-bound environment bootstrap meet the reviewed threat model, or
   should managed-TLS Compose deployments require a small shared CA volume
   instead?
6. What maximum upload size, HTTP disk-buffer size, console buffer,
   per-browser queue, and per-client outbound byte budget fit the expected
   workloads?
7. What default capability TTL and bounded Range/resume session lifetime balance
   revocation speed against uninterrupted large downloads?
8. Should Relay permit multiple outstanding pairing invitations or enforce one
   at a time?
9. Should client key rotation be supported in the first release, or handled by
   pair-new/revoke-old?
10. Should metrics use a fixed Relay interval or negotiated subscription rates
    with an enforced minimum?
11. Should the credential-free browser trust probe share `/health`, or use a
    separate endpoint with a stricter fixed CORS response?
12. Should an environment-provided `KILN_RELAY_NAME` remain an initialization
    seed only, or intentionally override a later UI rename on every restart?
13. Should the setup UI recommend a publicly trusted certificate over private
    CA installation whenever the Relay is reachable through public DNS?
14. Which ACME DNS providers should Relay support initially, and should the
    first release instead rely on mounted certificates plus Relay-private CA?
15. Should production SFTP authentication always fail closed while the issuing
    Hearth is unavailable, or may Relay use a short-lived signed permission
    snapshot with an explicit revocation-latency tradeoff?
16. Should SFTP virtual directories always use immutable instance IDs, or a
    sanitized display-name plus immutable short ID while routing only by ID?
17. Should the public SFTP parser run in Relay initially, or in a separate
    unprivileged worker/process without Docker-socket access for stronger
    isolation?
18. Across the supported browser matrix, can cross-origin POST attachment
    downloads preserve native download-manager Range/resume behavior, or does
    Kiln need a different proof-bound transfer-session handoff?

## Standards references

- [RFC 6455 — The WebSocket Protocol](https://www.rfc-editor.org/rfc/rfc6455)
- [RFC 8446 — TLS 1.3](https://www.rfc-editor.org/rfc/rfc8446)
- [RFC 8032 — Edwards-Curve Digital Signature Algorithm](https://www.rfc-editor.org/rfc/rfc8032)
- [RFC 4648 — Base-N Encodings](https://www.rfc-editor.org/rfc/rfc4648)
- [RFC 2104 — HMAC](https://www.rfc-editor.org/rfc/rfc2104)
- [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110)
- [RFC 6266 — Content-Disposition in HTTP](https://www.rfc-editor.org/rfc/rfc6266)
- [RFC 8555 — Automatic Certificate Management Environment](https://www.rfc-editor.org/rfc/rfc8555)
- [RFC 4253 — SSH Transport Layer Protocol](https://www.rfc-editor.org/rfc/rfc4253)
- [RFC 4254 — SSH Connection Protocol](https://www.rfc-editor.org/rfc/rfc4254)
- [W3C Web Cryptography API](https://www.w3.org/TR/WebCryptoAPI/)
- [Let's Encrypt challenge types](https://letsencrypt.org/ca/docs/challenge-types/)
