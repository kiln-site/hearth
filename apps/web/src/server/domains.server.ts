import type { RelayInstance } from "@workspace/contracts"
import { relayInstanceSchema, relaySnapshotSchema } from "@workspace/contracts"
import { Effect } from "effect"

import {
  cloudflareAddressRecord,
  cloudflareHostnameAvailableEffect,
  createCloudflareAddressRecordEffect,
  createCloudflareSrvRecordEffect,
  deleteCloudflareRecordEffect,
  resolveCloudflareZoneEffect,
  updateCloudflareAddressRecordEffect,
  updateCloudflareSrvRecordEffect,
} from "@/effect/cloudflare-api"
import {
  activateInstanceDomainAssignmentEffect,
  loadActiveInstanceDomainAssignmentsEffect,
  loadCloudflareIntegrationCredentialEffect,
  loadDomainIntegrationEffect,
  loadInstanceDomainAssignmentEffect,
  loadUsedVanityLabelsEffect,
  recordInstanceDomainErrorEffect,
  reserveInstanceDomainAssignmentEffect,
  saveCloudflareIntegrationEffect,
  updateInstanceDomainLabelEffect,
  type CloudflareIntegrationCredential,
  type InstanceDomainAssignment,
} from "@/effect/domains"
import { ExternalServiceError } from "@/effect/errors"
import { runAppEffect } from "@/effect/runtime"
import { isPlatformAdmin, requireRelayPermission } from "@/lib/access-control"
import {
  validateBlacklistPatterns,
  vanityLabelAllowed,
} from "@/lib/domain-schemas"
import type { FleetRelayInstance } from "@/lib/relay-fleet"
import type { PersistedRelay } from "@/lib/relay-registry"
import { listPersistedRelays } from "@/lib/relay-registry"
import { relayJsonEffect } from "@/lib/relay-client"
import { requireAuthenticatedUser } from "@/server/auth"
import {
  defaultSrvService,
  generateVanityCandidates,
} from "@/server/vanity-names"
import type {
  ConfigureDomainInput,
  InstanceDomainInput,
  InstanceDomainOverview,
  SetVanityInput,
} from "@/server/domains"

export async function getDomainSettingsHandler() {
  await requireDomainAdministrator()
  const [integration, assignments] = await Promise.all([
    runAppEffect("domains.integration.load", loadDomainIntegrationEffect()),
    runAppEffect(
      "domains.assignments.active",
      loadActiveInstanceDomainAssignmentsEffect()
    ),
  ])
  return {
    integration,
    managedServerCount: assignments.length,
  }
}

export async function configureDomainIntegrationHandler(
  data: ConfigureDomainInput
) {
  await requireDomainAdministrator()
  const blacklistPatterns = validateBlacklistPatterns(data.blacklistPatterns)
  const existing = await runAppEffect(
    "domains.integration.load",
    loadDomainIntegrationEffect()
  )
  if (existing && existing.domain !== data.domain) {
    const usedLabels = await runAppEffect(
      "domains.assignments.usedLabels",
      loadUsedVanityLabelsEffect(existing.domain)
    )
    if (usedLabels.size > 0) {
      throw new Error(
        "The vanity domain cannot change while managed server records exist"
      )
    }
  }
  const apiToken =
    data.apiToken ??
    (
      await runAppEffect(
        "domains.integration.credential",
        loadCloudflareIntegrationCredentialEffect()
      ).catch(() => null)
    )?.apiToken
  if (!apiToken) throw new Error("Enter a Cloudflare API token")
  const zone = await runAppEffect(
    "cloudflare.zone.resolve",
    resolveCloudflareZoneEffect(apiToken, data.domain)
  )
  await runAppEffect(
    "domains.integration.save",
    saveCloudflareIntegrationEffect({
      apiToken,
      blacklistPatterns,
      domain: data.domain,
      enabled: data.enabled,
      zoneId: zone.id,
      zoneName: zone.name,
    })
  )
  return {
    integration: await runAppEffect(
      "domains.integration.load",
      loadDomainIntegrationEffect()
    ),
  }
}

export async function getInstanceDomainHandler(data: InstanceDomainInput) {
  const user = await requireAuthenticatedUser()
  await requireRelayPermission({
    instanceId: data.instanceId,
    permission: "instance.network.read",
    relayId: data.relayId,
    user,
  })
  const [assignment, integration] = await Promise.all([
    runAppEffect(
      "domains.assignment.load",
      loadInstanceDomainAssignmentEffect(data.relayId, data.instanceId)
    ),
    runAppEffect("domains.integration.load", loadDomainIntegrationEffect()),
  ])
  return {
    assignment: assignment ? assignmentOverview(assignment) : null,
    managedDomain: integration?.enabled === true ? integration.domain : null,
  }
}

export async function setInstanceVanityHandler(data: SetVanityInput) {
  const { instance } = await loadWritableInstance(data.relayId, data.instanceId)
  return runAppEffect(
    "domains.instance.setVanity",
    setInstanceVanityEffect(
      { ...instance, relayId: data.relayId },
      data.vanityLabel
    )
  )
}

export async function provisionInstanceDomainBestEffort(
  instance: RelayInstance,
  relayId: string
): Promise<void> {
  try {
    await runAppEffect(
      "domains.instance.provision",
      provisionInstanceDomainEffect({ ...instance, relayId })
    )
  } catch (cause) {
    console.warn(
      `[Kiln Domains] Server ${instance.id} was provisioned, but its vanity address could not be created:`,
      cause
    )
  }
}

export const applyManagedDomainAddressesEffect = Effect.fn(
  "domains.assignments.apply"
)(function* (instances: Array<FleetRelayInstance>) {
  if (instances.length === 0) return instances
  const assignments = yield* loadActiveInstanceDomainAssignmentsEffect()
  const addresses = new Map(
    assignments.map((assignment) => [
      assignmentKey(assignment.relayId, assignment.instanceId),
      assignmentConnectAddress(assignment),
    ])
  )
  return instances.map((instance) => ({
    ...instance,
    connectAddress:
      addresses.get(assignmentKey(instance.relayId, instance.id)) ??
      instance.connectAddress,
  }))
})

const provisionInstanceDomainEffect = Effect.fn("domains.instance.provision")(
  function* (instance: RelayInstance & { relayId: string }) {
    const publicHost = instance.publicHost
    const publicPort = instance.publicPort
    if (!publicHost || !publicPort) return null
    const integration = yield* loadDomainIntegrationEffect()
    if (!integration?.enabled) return null
    const credential = yield* loadCloudflareIntegrationCredentialEffect()
    const existing = yield* loadInstanceDomainAssignmentEffect(
      instance.relayId,
      instance.id
    )
    if (existing?.status === "active") return assignmentOverview(existing)
    const candidates = generateVanityCandidates(credential.blacklistPatterns)
    const vanityLabel = yield* availableVanityLabelEffect(
      credential,
      candidates
    )
    return yield* provisionVanityRecordsEffect(
      credential,
      instance,
      vanityLabel
    )
  }
)

const setInstanceVanityEffect = Effect.fn("domains.instance.setVanity")(
  function* (
    instance: RelayInstance & { relayId: string },
    vanityLabel: string
  ) {
    const publicHost = instance.publicHost
    const publicPort = instance.publicPort
    if (!publicHost || !publicPort) {
      return yield* domainFailure(
        "Update this Relay before assigning a vanity address"
      )
    }
    const credential = yield* loadCloudflareIntegrationCredentialEffect()
    if (!credential.enabled) {
      return yield* domainFailure(
        "Managed domains are disabled by the platform administrator"
      )
    }
    if (!vanityLabelAllowed(vanityLabel, credential.blacklistPatterns)) {
      return yield* domainFailure(
        "That server address is reserved by the platform administrator"
      )
    }
    const assignment = yield* loadInstanceDomainAssignmentEffect(
      instance.relayId,
      instance.id
    )
    if (!assignment || assignment.status !== "active") {
      const available = yield* availableVanityLabelEffect(credential, [
        vanityLabel,
      ])
      return yield* provisionVanityRecordsEffect(
        credential,
        instance,
        available
      )
    }
    if (assignment.vanityLabel === vanityLabel) {
      return assignmentOverview(assignment)
    }
    yield* assertVanityAvailableEffect(credential, vanityLabel)
    return yield* renameVanityRecordsEffect(credential, assignment, vanityLabel)
  }
)

const provisionVanityRecordsEffect = Effect.fn(
  "domains.instance.createRecords"
)(function* (
  credential: CloudflareIntegrationCredential,
  instance: RelayInstance & { relayId: string },
  vanityLabel: string
) {
  const publicHost = instance.publicHost
  const publicPort = instance.publicPort
  if (!publicHost || !publicPort) {
    return yield* domainFailure("The Relay did not report a public endpoint")
  }
  const supportsSrv =
    instance.brickSupportsSrv && instance.brickPrimaryPortProtocol !== undefined
  const srvProtocol = supportsSrv
    ? (instance.brickPrimaryPortProtocol ?? null)
    : null
  const srvService = supportsSrv ? defaultSrvService(instance.game) : null
  yield* reserveInstanceDomainAssignmentEffect({
    domain: credential.domain,
    instanceId: instance.id,
    publicHost,
    publicPort,
    relayId: instance.relayId,
    srvProtocol,
    srvService,
    supportsSrv,
    vanityLabel,
  })
  const hostname = `${vanityLabel}.${credential.domain}`
  const address = cloudflareAddressRecord(hostname, publicHost)
  const addressRecord = yield* createCloudflareAddressRecordEffect(
    credential.apiToken,
    credential.zoneId,
    address,
    instance.id
  ).pipe(
    Effect.tapError((error) =>
      recordInstanceDomainErrorEffect(
        instance.relayId,
        instance.id,
        error.message
      )
    )
  )
  const srvRecord =
    supportsSrv && srvProtocol && srvService
      ? yield* createCloudflareSrvRecordEffect(
          credential.apiToken,
          credential.zoneId,
          srvRecordInput(
            hostname,
            publicPort,
            srvService,
            srvProtocol,
            address.type === "CNAME" ? publicHost : hostname
          ),
          instance.id
        ).pipe(
          Effect.catch((error) =>
            deleteCloudflareRecordEffect(
              credential.apiToken,
              credential.zoneId,
              addressRecord.id
            ).pipe(
              Effect.catch(() => Effect.void),
              Effect.andThen(
                recordInstanceDomainErrorEffect(
                  instance.relayId,
                  instance.id,
                  error.message
                )
              ),
              Effect.andThen(Effect.fail(error))
            )
          )
        )
      : null
  yield* activateInstanceDomainAssignmentEffect({
    addressRecordId: addressRecord.id,
    addressRecordType: address.type,
    instanceId: instance.id,
    relayId: instance.relayId,
    srvRecordId: srvRecord?.id ?? null,
  }).pipe(
    Effect.catch((error) =>
      Effect.all([
        deleteCloudflareRecordEffect(
          credential.apiToken,
          credential.zoneId,
          addressRecord.id
        ).pipe(Effect.catch(() => Effect.void)),
        srvRecord
          ? deleteCloudflareRecordEffect(
              credential.apiToken,
              credential.zoneId,
              srvRecord.id
            ).pipe(Effect.catch(() => Effect.void))
          : Effect.void,
      ]).pipe(
        Effect.andThen(
          recordInstanceDomainErrorEffect(
            instance.relayId,
            instance.id,
            error.message
          )
        ),
        Effect.andThen(Effect.fail(error))
      )
    )
  )
  const assignment = yield* loadInstanceDomainAssignmentEffect(
    instance.relayId,
    instance.id
  )
  if (!assignment) {
    return yield* domainFailure("The vanity address could not be saved")
  }
  return assignmentOverview(assignment)
})

const renameVanityRecordsEffect = Effect.fn("domains.instance.renameRecords")(
  function* (
    credential: CloudflareIntegrationCredential,
    assignment: InstanceDomainAssignment,
    vanityLabel: string
  ) {
    const addressRecordId = assignment.addressRecordId
    const addressRecordType = assignment.addressRecordType
    if (!addressRecordId || !addressRecordType) {
      return yield* domainFailure(
        "The managed address is missing its Cloudflare record"
      )
    }
    const previousHostname = `${assignment.vanityLabel}.${assignment.domain}`
    const nextHostname = `${vanityLabel}.${assignment.domain}`
    const rename = Effect.gen(function* () {
      yield* updateCloudflareAddressRecordEffect(
        credential.apiToken,
        credential.zoneId,
        addressRecordId,
        cloudflareAddressRecord(nextHostname, assignment.publicHost),
        assignment.instanceId
      )
      if (
        assignment.supportsSrv &&
        assignment.srvRecordId &&
        assignment.srvService &&
        assignment.srvProtocol
      ) {
        yield* updateCloudflareSrvRecordEffect(
          credential.apiToken,
          credential.zoneId,
          assignment.srvRecordId,
          srvRecordInput(
            nextHostname,
            assignment.publicPort,
            assignment.srvService,
            assignment.srvProtocol,
            assignment.addressRecordType === "CNAME"
              ? assignment.publicHost
              : nextHostname
          ),
          assignment.instanceId
        )
      }
      yield* updateInstanceDomainLabelEffect({
        instanceId: assignment.instanceId,
        relayId: assignment.relayId,
        vanityLabel,
      })
    })
    yield* rename.pipe(
      Effect.catch((error) =>
        rollbackVanityRenameEffect(
          credential,
          assignment,
          previousHostname
        ).pipe(Effect.andThen(Effect.fail(error)))
      )
    )
    const updated = yield* loadInstanceDomainAssignmentEffect(
      assignment.relayId,
      assignment.instanceId
    )
    if (!updated) return yield* domainFailure("The vanity address disappeared")
    return assignmentOverview(updated)
  }
)

const rollbackVanityRenameEffect = Effect.fn("domains.instance.rollbackRename")(
  function* (
    credential: CloudflareIntegrationCredential,
    assignment: InstanceDomainAssignment,
    hostname: string
  ) {
    if (assignment.addressRecordId) {
      yield* updateCloudflareAddressRecordEffect(
        credential.apiToken,
        credential.zoneId,
        assignment.addressRecordId,
        cloudflareAddressRecord(hostname, assignment.publicHost),
        assignment.instanceId
      ).pipe(Effect.catch(() => Effect.void))
    }
    if (
      assignment.srvRecordId &&
      assignment.srvService &&
      assignment.srvProtocol
    ) {
      yield* updateCloudflareSrvRecordEffect(
        credential.apiToken,
        credential.zoneId,
        assignment.srvRecordId,
        srvRecordInput(
          hostname,
          assignment.publicPort,
          assignment.srvService,
          assignment.srvProtocol,
          assignment.addressRecordType === "CNAME"
            ? assignment.publicHost
            : hostname
        ),
        assignment.instanceId
      ).pipe(Effect.catch(() => Effect.void))
    }
  }
)

const availableVanityLabelEffect = Effect.fn("domains.instance.availableLabel")(
  function* (
    credential: CloudflareIntegrationCredential,
    candidates: Array<string>
  ) {
    const used = yield* loadUsedVanityLabelsEffect(credential.domain)
    for (const candidate of candidates) {
      if (
        used.has(candidate) ||
        !vanityLabelAllowed(candidate, credential.blacklistPatterns)
      ) {
        continue
      }
      const available = yield* cloudflareHostnameAvailableEffect(
        credential.apiToken,
        credential.zoneId,
        `${candidate}.${credential.domain}`
      )
      if (available) return candidate
    }
    return yield* domainFailure(
      candidates.length === 1
        ? "That server address is already in use"
        : "Kiln could not find an available vanity address"
    )
  }
)

const assertVanityAvailableEffect = Effect.fn(
  "domains.instance.assertAvailable"
)(function* (credential: CloudflareIntegrationCredential, vanityLabel: string) {
  const used = yield* loadUsedVanityLabelsEffect(credential.domain)
  if (used.has(vanityLabel)) {
    return yield* domainFailure("That server address is already in use")
  }
  const available = yield* cloudflareHostnameAvailableEffect(
    credential.apiToken,
    credential.zoneId,
    `${vanityLabel}.${credential.domain}`
  )
  if (!available) {
    return yield* domainFailure("That server address is already in use")
  }
})

function srvRecordInput(
  hostname: string,
  port: number,
  service: string,
  protocol: "tcp" | "udp",
  target: string
) {
  return {
    name: `_${service}._${protocol}.${hostname}`,
    port,
    priority: 0,
    target,
    weight: 0,
  }
}

function assignmentOverview(
  assignment: InstanceDomainAssignment
): InstanceDomainOverview {
  return {
    address: assignmentConnectAddress(assignment),
    directAddress: connectAddress(assignment.publicHost, assignment.publicPort),
    domain: assignment.domain,
    lastError: assignment.lastError,
    status: assignment.status,
    supportsSrv: assignment.supportsSrv,
    vanityLabel: assignment.vanityLabel,
  }
}

function assignmentConnectAddress(
  assignment: InstanceDomainAssignment
): string {
  const hostname = `${assignment.vanityLabel}.${assignment.domain}`
  return assignment.supportsSrv
    ? hostname
    : connectAddress(hostname, assignment.publicPort)
}

function connectAddress(hostname: string, port: number): string {
  const host =
    hostname.includes(":") && !hostname.startsWith("[")
      ? `[${hostname}]`
      : hostname
  return `${host}:${port}`
}

function assignmentKey(relayId: string, instanceId: string): string {
  return `${relayId}:${instanceId}`
}

async function requireDomainAdministrator() {
  const user = await requireAuthenticatedUser()
  if (!isPlatformAdmin(user)) {
    throw new Error("Platform administrator access required")
  }
  return user
}

async function loadWritableInstance(relayId: string, instanceId: string) {
  const user = await requireAuthenticatedUser()
  const relay = await requiredRelay(relayId)
  await requireRelayPermission({
    instanceId,
    permission: "instance.network.write",
    relayId,
    user,
  })
  const snapshot = relaySnapshotSchema.parse(
    await runAppEffect(
      "relay.snapshot.domain",
      relayJsonEffect(relay, "/v1/snapshot", (input) => input)
    )
  )
  const instance = snapshot.instances.find((item) => item.id === instanceId)
  if (!instance) throw new Error("Instance not found")
  return { instance: relayInstanceSchema.parse(instance) }
}

async function requiredRelay(id: string): Promise<PersistedRelay> {
  const relay = (await listPersistedRelays()).find(
    (item) => item.enabled && item.id === id
  )
  if (!relay) throw new Error("Relay not found")
  return relay
}

function domainFailure(
  message: string
): Effect.Effect<never, ExternalServiceError> {
  return Effect.fail(
    ExternalServiceError.make({
      message,
      service: "Cloudflare",
    })
  )
}
