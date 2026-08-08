import { describe, expect, it } from "vite-plus/test"

import {
  databaseAclLoadArguments,
  databaseEngineSpec,
  databaseRecoveryLabels,
} from "./databases.js"

describe("managed database recovery metadata", () => {
  it("uses supported official images and private internal ports", () => {
    expect(databaseEngineSpec("mysql")).toMatchObject({
      image: "mysql:8.4",
      internalPort: 3306,
      supportsImportExport: true,
    })
    expect(databaseEngineSpec("mariadb")).toMatchObject({
      image: "mariadb:11.8",
      internalPort: 3306,
      supportsImportExport: true,
    })
    expect(databaseEngineSpec("postgres")).toMatchObject({
      image: "postgres:17",
      internalPort: 5432,
      supportsImportExport: true,
    })
    expect(databaseEngineSpec("redis")).toMatchObject({
      image: "redis:8",
      internalPort: 6379,
      supportsImportExport: false,
    })
    expect(databaseEngineSpec("valkey")).toMatchObject({
      image: "valkey/valkey:8",
      internalPort: 6379,
      supportsImportExport: false,
    })
  })

  it("writes recoverable ownership labels without credentials", () => {
    const labels = databaseRecoveryLabels(
      { resourceNamespace: "kiln-test" },
      {
        databaseName: "kiln_app",
        engine: "postgres",
        id: "a".repeat(40),
        name: "Main database",
      },
      "2026-08-06T12:00:00.000Z"
    )

    expect(labels).toMatchObject({
      "kiln.database.database-name": "kiln_app",
      "kiln.database.engine": "postgres",
      "kiln.database.hostname": `database-${"a".repeat(40)}`,
      "kiln.database.id": "a".repeat(40),
      "kiln.database.image": "postgres:17",
      "kiln.database.name": "Main database",
      "kiln.relay.managed": "true",
      "kiln.relay.owner": "kiln-test",
      "kiln.relay.owned": "true",
      "kiln.resource.kind": "database",
    })
    expect(Object.keys(labels).join(" ")).not.toMatch(
      /password|username|secret/u
    )
  })

  it("does not collide resources when database ids share a short prefix", () => {
    const first = databaseRecoveryLabels(
      { resourceNamespace: "kiln-test" },
      {
        databaseName: "kiln_first",
        engine: "postgres",
        id: `${"a".repeat(8)}${"b".repeat(32)}`,
        name: "First database",
      },
      "2026-08-06T12:00:00.000Z"
    )
    const second = databaseRecoveryLabels(
      { resourceNamespace: "kiln-test" },
      {
        databaseName: "kiln_second",
        engine: "postgres",
        id: `${"a".repeat(8)}${"c".repeat(32)}`,
        name: "Second database",
      },
      "2026-08-06T12:00:00.000Z"
    )

    expect(first["kiln.database.hostname"]).not.toBe(
      second["kiln.database.hostname"]
    )
    expect(first["kiln.database.network"]).not.toBe(
      second["kiln.database.network"]
    )
    expect(first["kiln.database.volume"]).not.toBe(
      second["kiln.database.volume"]
    )
  })
})

describe("managed database credential rotation", () => {
  const credentialRotationCases: ReadonlyArray<
    readonly ["redis" | "valkey", string, string]
  > = [
    ["redis", "REDISCLI_AUTH", "redis-cli"],
    ["valkey", "VALKEYCLI_AUTH", "valkey-cli"],
  ]

  it.each(credentialRotationCases)(
    "passes %s authentication through the client environment",
    (engine, environmentName, client) => {
      const arguments_ = databaseAclLoadArguments(
        engine,
        "container-id",
        "kiln_user",
        "current-password"
      )

      expect(arguments_).toContain(`${environmentName}=current-password`)
      expect(arguments_).toContain(client)
      expect(arguments_).not.toContain("-a")
      expect(arguments_).not.toContain("current-password")
    }
  )
})
