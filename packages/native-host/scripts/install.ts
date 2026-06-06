#!/usr/bin/env bun
/**
 * Registers the Native Messaging host with Chrome.
 *
 * Native Messaging requires the manifest's `path` to point at an *executable*, so
 * this writes a small launcher shell script that runs the host via Bun, then drops
 * the host manifest into Chrome's NativeMessagingHosts directory.
 *
 * Usage:
 *   bun run scripts/install.ts --extension-id <id>
 *   OBC_EXTENSION_ID=<id> bun run scripts/install.ts
 *
 * NOTE: skeleton scope — registration is provided so the transport is ready to
 * wire, but the host does not yet relay messages anywhere.
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";

const HOST_NAME = "com.open_browser_control.host";
const packageRoot = resolve(import.meta.dir, "..");
const hostEntry = join(packageRoot, "src", "index.ts");
const launcherPath = join(packageRoot, "bin", "obc-native-host.sh");

function parseExtensionId(): string {
  const flagIndex = process.argv.indexOf("--extension-id");
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) {
    return process.argv[flagIndex + 1]!;
  }
  return process.env["OBC_EXTENSION_ID"] ?? "__EXTENSION_ID__";
}

function hostManifestDir(): string {
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(
        home,
        "Library",
        "Application Support",
        "Google",
        "Chrome",
        "NativeMessagingHosts",
      );
    case "linux":
      return join(home, ".config", "google-chrome", "NativeMessagingHosts");
    default:
      throw new Error(`Unsupported platform for auto-install: ${platform()}`);
  }
}

function writeLauncher(): void {
  mkdirSync(dirname(launcherPath), { recursive: true });
  writeFileSync(launcherPath, `#!/bin/sh\nexec bun run "${hostEntry}"\n`);
  chmodSync(launcherPath, 0o755);
}

function writeHostManifest(extensionId: string): void {
  const template = JSON.parse(
    readFileSync(join(packageRoot, "host-manifest.template.json"), "utf8"),
  ) as Record<string, unknown>;
  template["path"] = launcherPath;
  template["allowed_origins"] = [`chrome-extension://${extensionId}/`];

  const dir = hostManifestDir();
  mkdirSync(dir, { recursive: true });
  const manifestPath = join(dir, `${HOST_NAME}.json`);
  writeFileSync(manifestPath, `${JSON.stringify(template, null, 2)}\n`);
  return void console.error(`[install] wrote ${manifestPath}`);
}

const extensionId = parseExtensionId();
writeLauncher();
console.error(`[install] launcher: ${launcherPath}`);
writeHostManifest(extensionId);
if (extensionId === "__EXTENSION_ID__") {
  console.error(
    "[install] WARNING: no extension id given; re-run with --extension-id <id> " +
      "once the extension is loaded.",
  );
}
