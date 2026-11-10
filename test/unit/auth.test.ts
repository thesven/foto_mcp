import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  loadStoredCredentials,
  saveCredentials,
  clearCredentials,
  signInWithEmailAndPassword,
  refreshIdToken,
  getValidAuthSession,
  getAuthStatus,
  encryptCredentialsPayload,
  decryptCredentialsPayload,
  listProfiles,
  switchProfile,
  getActiveProfileName
} from "../../src/api/auth.js";
import { CONFIG_PATHS } from "../../src/config.js";

export async function runAuthTests() {
  console.log("--- Testing Auth API module ---");

  const originalFetch = globalThis.fetch;
  const originalEnvEmail = process.env.FOTO_EMAIL;
  const originalEnvPass = process.env.FOTO_PASSWORD;

  try {
    // 1. Clear credentials
    await clearCredentials();
    const noCreds = await loadStoredCredentials();
    assert.strictEqual(noCreds, null);

    // 2. Save credentials and reload
    const sampleCreds = {
      userId: "u123",
      email: "test@example.com",
      idToken: "id-tok-123",
      refreshToken: "ref-tok-456",
      expiresAt: Date.now() + 3600000
    };
    await saveCredentials(sampleCreds);

    const loaded = await loadStoredCredentials();
    assert.strictEqual(loaded?.userId, "u123");
    assert.strictEqual(loaded?.email, "test@example.com");

    // 2b. Test AES-256-GCM encryption & decryption roundtrip
    const encrypted = encryptCredentialsPayload(sampleCreds);
    assert(encrypted.includes(":"), "Encrypted payload must have iv:tag:ciphertext format");
    const decrypted = decryptCredentialsPayload(encrypted);
    assert.strictEqual(decrypted?.userId, "u123");
    assert.strictEqual(decryptCredentialsPayload("invalid:payload"), null);

    // 2c. Test Multi-Profile save, list, and switch
    await saveCredentials(
      {
        userId: "u_street",
        email: "street@example.com",
        idToken: "tok-street",
        refreshToken: "ref-street",
        expiresAt: Date.now() + 3600000
      },
      "street"
    );
    assert.strictEqual(getActiveProfileName(), "street");

    const profilesList = await listProfiles();
    assert(profilesList.profiles.length >= 2);
    assert.strictEqual(profilesList.activeProfile, "street");

    const switched = await switchProfile("default");
    assert.strictEqual(switched.success, true);
    assert.strictEqual(switched.activeProfile, "default");
    assert.strictEqual(switched.userId, "u123");

    await assert.rejects(
      async () => {
        await switchProfile("nonexistent_profile");
      },
      /not found/
    );

    // Clear single profile and check credentials.json sync to remaining active profile
    await clearCredentials("street");
    const activeAfterDelete = await loadStoredCredentials();
    assert.strictEqual(activeAfterDelete?.userId, "u123");

    // 3. Clear credentials again
    await clearCredentials();

    // 4. signInWithEmailAndPassword - Missing credentials error
    delete process.env.FOTO_EMAIL;
    delete process.env.FOTO_PASSWORD;
    await assert.rejects(
      async () => {
        await signInWithEmailAndPassword();
      },
      /Missing credentials/
    );

    // 5. signInWithEmailAndPassword - Success
    globalThis.fetch = async (url: any) => {
      return new Response(
        JSON.stringify({
          email: "test@example.com",
          localId: "uid-789",
          idToken: "new-id-token",
          refreshToken: "new-refresh-token",
          expiresIn: "3600"
        }),
        { status: 200 }
      );
    };

    const signedIn = await signInWithEmailAndPassword("test@example.com", "secret123", "studio");
    assert.strictEqual(signedIn.userId, "uid-789");
    assert.strictEqual(signedIn.idToken, "new-id-token");
    assert.strictEqual(signedIn.profileName, "studio");

    // 6. signInWithEmailAndPassword - INVALID_LOGIN_CREDENTIALS error
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          error: { message: "INVALID_LOGIN_CREDENTIALS" }
        }),
        { status: 400 }
      );
    };

    await assert.rejects(
      async () => {
        await signInWithEmailAndPassword("bad@example.com", "wrongpass");
      },
      /Invalid Foto email or password/
    );

    // 7. signInWithEmailAndPassword - Generic error
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          error: { message: "TOO_MANY_ATTEMPTS_TRY_LATER" }
        }),
        { status: 400 }
      );
    };

    await assert.rejects(
      async () => {
        await signInWithEmailAndPassword("spam@example.com", "pass");
      },
      /Foto authentication error: TOO_MANY_ATTEMPTS_TRY_LATER/
    );

    // 8. refreshIdToken - Success
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          user_id: "uid-789",
          id_token: "refreshed-id-token",
          refresh_token: "re-refreshed-token",
          expires_in: "3600"
        }),
        { status: 200 }
      );
    };

    const refreshed = await refreshIdToken("some-refresh-token");
    assert.strictEqual(refreshed.idToken, "refreshed-id-token");

    // 9. refreshIdToken - Error
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          error: { message: "TOKEN_EXPIRED" }
        }),
        { status: 400 }
      );
    };

    await assert.rejects(
      async () => {
        await refreshIdToken("expired-refresh-token");
      },
      /Failed to refresh Foto token/
    );

    // 10. getValidAuthSession - Fresh token in memory/disk
    await saveCredentials({
      userId: "u123",
      idToken: "fresh-token",
      refreshToken: "r1",
      expiresAt: Date.now() + 100000
    });
    const validSession = await getValidAuthSession();
    assert.strictEqual(validSession.idToken, "fresh-token");

    // 11. getValidAuthSession - Expired token, auto-refreshed
    await saveCredentials({
      userId: "u123",
      idToken: "stale-token",
      refreshToken: "valid-ref",
      expiresAt: Date.now() - 1000
    });

    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          user_id: "u123",
          id_token: "auto-refreshed-token",
          refresh_token: "valid-ref",
          expires_in: "3600"
        }),
        { status: 200 }
      );
    };
    const refreshedSession = await getValidAuthSession();
    assert.strictEqual(refreshedSession.idToken, "auto-refreshed-token");

    // 12. getValidAuthSession - Expired and refresh fails, but env vars present -> re-authenticate
    await saveCredentials({
      userId: "u123",
      idToken: "stale-token",
      refreshToken: "revoked-ref",
      expiresAt: Date.now() - 1000
    });
    process.env.FOTO_EMAIL = "env@example.com";
    process.env.FOTO_PASSWORD = "envpassword";
    globalThis.fetch = async (url: any) => {
      if (String(url).includes("securetoken")) {
        // refresh fails
        return new Response(JSON.stringify({ error: { message: "TOKEN_REVOKED" } }), { status: 400 });
      }
      // accounts:signInWithPassword succeeds
      return new Response(
        JSON.stringify({
          email: "env@example.com",
          localId: "env-user-id",
          idToken: "env-new-id-token",
          refreshToken: "env-ref-token",
          expiresIn: "3600"
        }),
        { status: 200 }
      );
    };

    const reauthedSession = await getValidAuthSession();
    assert.strictEqual(reauthedSession.userId, "env-user-id");

    // 13. getValidAuthSession - No credentials, falls back to env vars
    await clearCredentials();
    const envSession = await getValidAuthSession();
    assert.strictEqual(envSession.userId, "env-user-id");

    // 14. getValidAuthSession - No credentials, no env vars -> throws error
    await clearCredentials();
    delete process.env.FOTO_EMAIL;
    delete process.env.FOTO_PASSWORD;
    await assert.rejects(
      async () => {
        await getValidAuthSession();
      },
      /Not authenticated/
    );

    // 15. getAuthStatus checks
    // State A: Not logged in, no env vars
    const statusNoCreds = await getAuthStatus();
    assert.strictEqual(statusNoCreds.loggedIn, false);
    assert(statusNoCreds.message?.includes("No active Foto session found"));

    // State B: Not logged in, but FOTO_EMAIL configured in env
    process.env.FOTO_EMAIL = "photographer@example.com";
    const statusEnvOnly = await getAuthStatus();
    assert.strictEqual(statusEnvOnly.loggedIn, false);
    assert.strictEqual(statusEnvOnly.email, "photographer@example.com");

    // State C: Active session logged in
    await saveCredentials({
      userId: "user-456",
      email: "active@example.com",
      idToken: "tok",
      refreshToken: "ref",
      expiresAt: Date.now() + 1800000 // 30 min
    });
    const statusActive = await getAuthStatus();
    assert.strictEqual(statusActive.loggedIn, true);
    assert.strictEqual(statusActive.email, "active@example.com");
    assert.strictEqual(statusActive.encryptedAtRest, true);
    assert(statusActive.expiresInMinutes && statusActive.expiresInMinutes > 20);

    // State D: Expired token refresh fails when no env vars configured
    await saveCredentials({
      userId: "user-456",
      idToken: "tok",
      refreshToken: "broken-ref",
      expiresAt: Date.now() - 1000
    });
    delete process.env.FOTO_EMAIL;
    delete process.env.FOTO_PASSWORD;
    globalThis.fetch = async () => new Response("{}", { status: 400 });

    await assert.rejects(
      async () => {
        await getValidAuthSession();
      },
      /Authentication token expired and could not be refreshed/
    );

    // Clean up
    await clearCredentials();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnvEmail) process.env.FOTO_EMAIL = originalEnvEmail;
    else delete process.env.FOTO_EMAIL;
    if (originalEnvPass) process.env.FOTO_PASSWORD = originalEnvPass;
    else delete process.env.FOTO_PASSWORD;
  }

  console.log("  ✓ Auth unit tests passed");
}

