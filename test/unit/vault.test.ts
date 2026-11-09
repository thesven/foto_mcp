import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { VaultExporter } from "../../src/sync/vault.js";
import { FotoClient } from "../../src/foto-client.js";
import { saveCredentials, clearCredentials } from "../../src/api/auth.js";

export async function runVaultTests() {
  console.log("--- Testing Vault Export module ---");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "foto-mcp-vault-"));
  const client = new FotoClient();
  const vault = new VaultExporter(client);

  const originalFetch = globalThis.fetch;

  try {
    await saveCredentials({
      userId: "u_vault_user",
      idToken: "tok",
      refreshToken: "ref",
      expiresAt: Date.now() + 3600000
    });

    // 1. Dry run
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("user-profiles/u_vault_user")) {
        return new Response(
          JSON.stringify({
            fields: {
              userId: { stringValue: "u_vault_user" },
              postIds: { arrayValue: { values: [{ stringValue: "p_v1" }, { stringValue: "p_v2" }] } }
            }
          }),
          { status: 200 }
        );
      }
      return new Response("", { status: 404 });
    };

    const dryResult = await vault.exportVault({
      targetDirectory: path.join(tempDir, "dry_backup"),
      dryRun: true
    });
    assert.strictEqual(dryResult.dryRun, true);
    assert.strictEqual(dryResult.totalPosts, 2);

    // 2. Live export with image download and manifest creation
    const sampleImageBuffer = await sharp({
      create: { width: 500, height: 400, channels: 3, background: { r: 10, g: 20, b: 30 } }
    }).jpeg().toBuffer();

    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("user-profiles/u_vault_user")) {
        return new Response(
          JSON.stringify({
            fields: {
              userId: { stringValue: "u_vault_user" },
              username: { stringValue: "vaultmaster" },
              displayName: { stringValue: "Vault Master" },
              postIds: { arrayValue: { values: [{ stringValue: "p_v1" }] } }
            }
          }),
          { status: 200 }
        );
      }
      if (urlStr.includes("posts/p_v1")) {
        return new Response(
          JSON.stringify({
            fields: {
              postId: { stringValue: "p_v1" },
              userId: { stringValue: "u_vault_user" },
              description: { stringValue: "Mountain pass" },
              imageUrl: { stringValue: "https://storage.googleapis.com/test-bucket/p_v1.jpg" },
              imageWidth: { doubleValue: 1820 },
              imageHeight: { doubleValue: 1200 },
              tags: { arrayValue: { values: [{ stringValue: "Landscape" }] } },
              likes: { arrayValue: { values: [{ stringValue: "u2" }] } },
              commentCount: { integerValue: "3" },
              timeStamp: { timestampValue: "2026-05-01T12:00:00Z" }
            }
          }),
          { status: 200 }
        );
      }
      if (urlStr.includes("image-private-metadata")) {
        return new Response(
          JSON.stringify({
            fields: {
              exif: { mapValue: { fields: { Model: { stringValue: "Hasselblad 500C/M" } } } }
            }
          }),
          { status: 200 }
        );
      }
      if (urlStr.includes("storage.googleapis.com")) {
        return new Response(sampleImageBuffer, {
          status: 200,
          headers: { "Content-Type": "image/jpeg" }
        });
      }
      return new Response("", { status: 404 });
    };

    const targetBackupDir = path.join(tempDir, "live_backup");
    const liveResult = await vault.exportVault({
      targetDirectory: targetBackupDir,
      dryRun: false
    });

    assert.strictEqual(liveResult.success, true);
    assert.strictEqual(liveResult.totalPosts, 1);
    assert.strictEqual(liveResult.totalPhotosDownloaded, 1);

    // Verify downloaded photo exists
    const downloadedPhoto = path.join(targetBackupDir, "photos", "p_v1.jpg");
    const statPhoto = await fs.stat(downloadedPhoto);
    assert(statPhoto.size > 0);

    // Verify metadata sidecar JSON exists
    const sidecarFile = path.join(targetBackupDir, "metadata", "p_v1.json");
    const sidecarContent = JSON.parse(await fs.readFile(sidecarFile, "utf-8"));
    assert.strictEqual(sidecarFile ? sidecarContent.postId : "", "p_v1");
    assert.strictEqual(sidecarContent.caption, "Mountain pass");
    assert.strictEqual(sidecarContent.likesCount, 1);

    // Verify manifest.json exists
    const manifestFile = path.join(targetBackupDir, "manifest.json");
    const manifestContent = JSON.parse(await fs.readFile(manifestFile, "utf-8"));
    assert.strictEqual(manifestContent.totalPosts, 1);
    assert.strictEqual(manifestContent.tagsBreakdown.Landscape, 1);

    await clearCredentials();
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  console.log("  ✓ Vault unit tests passed");
}
