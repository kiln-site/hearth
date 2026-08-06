import { describe, expect, it } from "vite-plus/test"

import { databaseEngineSpec, databaseRecoveryLabels } from "./databases.js"

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
      "kiln.database.hostname": "database-aaaaaaaa",
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
})
