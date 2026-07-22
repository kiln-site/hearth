import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vite-plus/test"

import { discoverRelayAdvertisedHost, loadConfig } from "./config.js"

describe("loadConfig", () => {
  it("defaults the Relay and SFTP ports", () => {
    const config = loadConfig({ NODE_ENV: "development" })

    expect(config.port).toBe(4100)
    expect(config.publicPort).toBe(4100)
    expect(config.sftpPort).toBe(2022)
    expect(config.tlsMode).toBe("development")
    expect(config.sftpDevAuthentication).toBe(true)
  })

  it("uses an independent advertised port", () => {
    const config = loadConfig({
      KILN_RELAY_HOST: "relay.test",
      KILN_RELAY_PORT: "4100",
      KILN_RELAY_PUBLIC_PORT: "8443",
      NODE_ENV: "development",
    })

    expect(config.port).toBe(4100)
    expect(config.publicPort).toBe(8443)
    expect(config.browserOrigin).toBe("http://relay.test:8443")
  })

  it("infers a public address only when no host is configured", async () => {
    const inferred = loadConfig({ NODE_ENV: "development" })
    await expect(
      discoverRelayAdvertisedHost(inferred, {}, async () => "203.0.113.8")
    ).resolves.toBe("public_ip")
    expect(inferred.advertisedHost).toBe("203.0.113.8")
    expect(inferred.browserOrigin).toBe("http://203.0.113.8:4100")

    const configured = loadConfig({
      KILN_RELAY_HOST: "relay.test",
      NODE_ENV: "development",
    })
    await expect(
      discoverRelayAdvertisedHost(configured, {}, async () => "203.0.113.9")
    ).resolves.toBe("configured")
    expect(configured.advertisedHost).toBe("relay.test")
  })

  it("accepts a custom SFTP port", () => {
    const config = loadConfig({
      KILN_RELAY_SFTP_PORT: "22022",
      NODE_ENV: "development",
    })

    expect(config.sftpPort).toBe(22022)
  })

  it("normalizes boolean environment values", async () => {
    const config = loadConfig({
      KILN_RELAY_DISCOVER_PUBLIC_IP: " false ",
      KILN_RELAY_SFTP_DEV_AUTH: " true ",
      NODE_ENV: "development",
    })
    await expect(
      discoverRelayAdvertisedHost(
        config,
        { KILN_RELAY_DISCOVER_PUBLIC_IP: " false " },
        async () => "203.0.113.10"
      )
    ).resolves.toBe("hostname")
    expect(config.sftpDevAuthentication).toBe(true)
  })

  it("rejects invalid ports", () => {
    expect(() =>
      loadConfig({
        KILN_RELAY_SFTP_PORT: "70000",
        NODE_ENV: "development",
      })
    ).toThrow("KILN_RELAY_SFTP_PORT must be a valid TCP port")
  })

  it("cannot enable development transport or SFTP auth in production", () => {
    expect(() =>
      loadConfig({
        KILN_RELAY_TLS_MODE: "development",
        NODE_ENV: "production",
      })
    ).toThrow("Development Relay TLS cannot be used in production")

    expect(() =>
      loadConfig({
        KILN_RELAY_SFTP_DEV_AUTH: "true",
        NODE_ENV: "production",
      })
    ).toThrow("Development SFTP authentication cannot run in production")
  })

  it("reads a one-time bootstrap token from a Docker secret", () => {
    const directory = mkdtempSync(join(tmpdir(), "kiln-relay-config-"))
    const tokenFile = join(directory, "bootstrap-token")
    writeFileSync(tokenFile, "a".repeat(32))
    try {
      expect(
        loadConfig({
          KILN_RELAY_BOOTSTRAP_TOKEN_FILE: tokenFile,
          NODE_ENV: "development",
        }).bootstrapToken
      ).toBe("a".repeat(32))
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
