import { generateKeyPairSync, randomBytes, sign, verify } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, assert, describe, layer } from "@effect/vitest"
import { Effect } from "effect"

import { loadConfig } from "../config.js"
import { loadOrCreateRelayIdentity } from "./identity.js"
import {
  createPairingInvitation,
  decodePairingUri,
  pairingRequestTranscript,
  pairingResponseTranscript,
  pairHearth,
} from "./pairing.js"
import { makeRelayStateLayer, RelayStateStore } from "./state.js"
import type { PairingRequest } from "./pairing.js"

const testDirectory = mkdtempSync(join(tmpdir(), "kiln-relay-pairing-"))

afterAll(() => {
  rmSync(testDirectory, { force: true, recursive: true })
})

describe("Relay pairing", () => {
  layer(makeRelayStateLayer(join(testDirectory, "relay.sqlite")))((it) => {
    it.effect("proves both identities and consumes its invitation", () =>
      Effect.gen(function* () {
        const config = loadConfig({
          KILN_RELAY_DATA_DIR: testDirectory,
          KILN_RELAY_HOST: "relay.test",
          KILN_RELAY_NAME: "Pairing Relay",
          NODE_ENV: "development",
        })
        const state = yield* RelayStateStore
        const identity = yield* loadOrCreateRelayIdentity(config)
        const invitation = yield* createPairingInvitation({
          config,
          identity,
          role: "read_only",
          state,
          tls: null,
        })
        const decodedUri = decodePairingUri(invitation.uri)
        assert.strictEqual(decodedUri.relayFingerprint, identity.fingerprint)
        assert.strictEqual(
          decodedUri.controlEndpoint,
          "ws://relay.test:4100/v1/socket"
        )

        const hearthKeys = generateKeyPairSync("ed25519", {
          privateKeyEncoding: { format: "pem", type: "pkcs8" },
          publicKeyEncoding: { format: "pem", type: "spki" },
        })
        const unsigned: Omit<PairingRequest, "signature"> = {
          bootstrapProof: null,
          hearthName: "Hearth Test",
          hearthOrigin: "https://hearth.test",
          invitationId: invitation.envelope.invitationId,
          nonce: randomBytes(24).toString("base64url"),
          publicKeyPem: hearthKeys.publicKey,
          token: invitation.token,
          version: 1,
        }
        const request: PairingRequest = {
          ...unsigned,
          signature: sign(
            null,
            Buffer.from(
              pairingRequestTranscript({ ...unsigned, signature: "" })
            ),
            hearthKeys.privateKey
          ).toString("base64url"),
        }
        const response = yield* pairHearth({ identity, request, state })
        assert.strictEqual(response.role, "read_only")
        assert.isFalse(response.actions.includes("instance.power.start"))
        assert.isTrue(response.actions.includes("instance.console.read"))
        assert.isTrue(
          verify(
            null,
            Buffer.from(pairingResponseTranscript(response)),
            identity.publicKeyPem,
            Buffer.from(response.signature, "base64url")
          )
        )

        const secondAttempt = yield* Effect.result(
          pairHearth({ identity, request, state })
        )
        assert.strictEqual(secondAttempt._tag, "Failure")
      })
    )
  })
})
