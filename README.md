Kiln is an open-source, self-hosted platform for creating and managing
game-server environments. It is a modern reimagining of Pterodactyl's panel and
Wings model, built around a simpler setup and a faster, more focused experience.

> Connect a Relay, choose a Brick, and launch an Instance.

## Vocabulary

- **Kiln**: the umbrella product and ecosystem.
- **Hearth**: the web control plane that manages users, configuration, and
  orchestration.
- **Relay**: the agent that's deployed on a node/server with Docker that orchestrates and reports via Hearth
- **Ember**: the minimal container runtime in which an Instance runs.
- **Brick**: a reusable recipe that tells Relay which Ember to use and how to
  provision and configure an instance.
- **Instance**: a deployed workload created from a Brick and managed by Relay.

## Priorities

- **Performance**: keep the panel responsive and Relay interactions fast.
- **End-user experience**: make powerful server management feel approachable.
- **Simple setup and operation**: require as little infrastructure knowledge and
  configuration as possible.
- **Stability and reliability**: recover cleanly and behave predictably.
- **Safe self-hosting**: keep privileged node access on Relay, not the public
  Hearth control plane.

## Relay networking

Relay exposes encrypted HTTPS/WSS control and direct-transfer traffic on port
4100 by default. SFTP is a separate, shell-free SSH service on port 2022. Both
ports are configurable and neither requires port 443:

```env
KILN_RELAY_HOST=relay.example.com
KILN_RELAY_PORT=4100
KILN_RELAY_SFTP_PORT=2022
KILN_RELAY_TLS_MODE=managed
```

Set `KILN_RELAY_PUBLIC_PORT` when a reverse proxy maps the listener to a
different external port. If `KILN_RELAY_HOST` is omitted, Relay makes one
short, disableable public-DNS attempt and clearly labels the resulting address
as unverified. Set `KILN_RELAY_DISCOVER_PUBLIC_IP=false` to avoid that lookup.

On a fresh `/data`, Relay prints a one-time pairing URI and QR code that expires
after 15 minutes. Paste it into Hearth's Relay settings, review the Relay
identity and TLS fingerprint, and confirm. Later invitations are created in
Hearth or with `kiln-relay pair create`; their secret URI is returned only to
the caller. `kiln-relay pair list|revoke` and `kiln-relay hearth list|revoke`
remain available as host recovery commands.

Managed TLS creates a unique Relay CA and renewable leaf certificate in
`/data/network/tls`. Install only the public CA shown by Hearth in browsers that
need direct console, resource, upload, or download access. Mounted certificates
use `KILN_RELAY_TLS_MODE=external` with `KILN_RELAY_TLS_CERT_FILE` and
`KILN_RELAY_TLS_KEY_FILE`; Relay validates and hot-reloads replacements.

Back up the whole Relay `/data` directory. It contains the Relay identity,
client trust records, TLS CA, and SFTP host key. Hearth stores a different,
encrypted private key for every paired Relay. Losing either side requires a new
pairing; long-term private keys are never copied between Hearth installations.

Pre-WSS bearer-token Relays are intentionally incompatible. There is no
in-place credential migration: back up instance data, remove the old Hearth
Relay registration and old Relay networking identity/state, restart Relay, and
pair it again. Instance directories can remain in place.
