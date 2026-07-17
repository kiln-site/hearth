# Relay Lifecycle Ideas

> Shelved for now.

## Goal

Make Relay updates simple for self-hosted users without requiring GitHub
webhooks, deployment keys, or provider-specific integrations.

## Direction

- Kiln should eventually own the Relay lifecycle instead of sharing control with
  Coolify or another deployment platform.
- A small Kiln agent would manage the Relay container through Docker: check for
  releases, update it, verify its health, and roll back failures.
- Hearth would provide manual updates first, with optional automatic updates
  later.
- A floating `stable` channel would support updates; exact version tags and
  image digests would remain pinned.
- Until this exists, Relay updates remain the responsibility of the user's
  deployment platform.
