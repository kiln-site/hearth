# `kiln.brick/v1`

The v1 recipe is a strict YAML or JSON document. Unknown keys are rejected.
This prevents a misspelling from silently producing a less secure container.

## Contract

- `format` is exactly `kiln.brick/v1`. Semantics never change within a format.
- `metadata` identifies and describes the package. IDs are labels, not a Relay
  allowlist.
- `variables` defines the per-deployment form. A variable has a scalar type,
  optional default/options, validation rules, and a `sensitive` display hint.
- `runtime` selects any OCI image and maps resolved values to its environment,
  process, storage, and resource configuration.
- `console.stopCommands` optionally lists exact commands that intentionally stop
  the server when a user sends them through Hearth's console. Relay uses this
  only to suppress automatic crash recovery for that panel action; it does not
  interpret container signals, external console clients, or server log lines.
- `network` declares ports and one of three stable Relay routing modes.
- `constraints` can limit CPU architectures or allow only one instance of the
  recipe on a Relay.

The normative schema is [`schema/recipe-v1.schema.json`](../schema/recipe-v1.schema.json).

`runtime.resources.memory` is the exact Docker hard limit. The optional
`memoryReservation` is the soft reservation and defaults to the hard limit.
Runtime-specific overhead must fit inside that limit; Relay does not silently
increase it. The official Java Ember uses a container-aware heap percentage so
native JVM memory remains within the declared allocation.

## Templates

The following string templates are supported:

```text
{{ variables.<name> }}
{{ brick.id }}
{{ brick.name }}
```

Relay performs literal interpolation. Templates are not a shell and cannot run
expressions or commands. Every referenced variable must be declared and have a
resolved value.

## Networking modes

- `minecraft-backend` joins Relay's private game network and participates in
  generated Velocity routes without publishing a host port.
- `minecraft-proxy` publishes the primary TCP port at Relay's configured proxy
  port and receives Relay's generated Velocity configuration.
- `direct` publishes every declared port at `host` (or the same container port)
  for games that expose themselves directly.

The named `primaryPort` must match one entry in `ports`. Host port conflicts are
reported by Docker. Use `constraints.singleton: true` for fixed-port packages.

## Security boundary

Recipes are executable infrastructure: an image, entrypoint, command, and
environment determine what runs. Only deploy recipes you trust. Relay still
enforces its own storage root, read-only root filesystem, dropped capabilities,
`no-new-privileges`, PID limit, and isolated network; recipes cannot request
host paths, capabilities, privileged mode, or the Docker socket.

Custom recipe sources must use HTTPS. A Relay operator may explicitly configure
a local `file:` catalog for development or air-gapped installations.

## Compatibility

Relay dispatches on `format`. It should retain a decoder/executor for every safe
older format. A format may be disabled only when continuing to execute it would
be unsafe or when an explicitly documented migration is unavoidable.
