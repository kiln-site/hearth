import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const source = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../apps/web/scripts/migrate-app.mjs"
  ),
  "utf8"
)

test("adds the restic storage unique key before dropping the legacy unique", () => {
  const add = source.indexOf(
    'ADD UNIQUE KEY ${databaseTable("backup_repository_target_storage_unique")}'
  )
  const drop = source.indexOf(
    'DROP INDEX ${databaseTable("backup_repository_target_unique")}'
  )

  assert.notEqual(add, -1)
  assert.notEqual(drop, -1)
  assert.ok(add < drop)
})
