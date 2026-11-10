import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { FOTO_FIREBASE_CONFIG, CONFIG_PATHS } from "../config.js";

export interface StoredCredentials {
  email?: string;
  userId: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp ms
  profileName?: string;
}

export interface AuthStatus {
  loggedIn: boolean;
  activeProfile: string;
  email?: string;
  userId?: string;
  expiresInMinutes?: number;
  encryptedAtRest?: boolean;
  message?: string;
}

export interface ProfileSummary {
  profileName: string;
  active: boolean;
  userId: string;
  email?: string;
  expiresInMinutes: number;
  loggedIn: boolean;
}

interface ProfilesRegistry {
  activeProfile: string;
  profiles: Record<string, StoredCredentials | { __encrypted: string }>;
}

let activeProfileName = "default";
const inMemoryProfiles = new Map<string, StoredCredentials>();

async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(CONFIG_PATHS.configDir, { recursive: true, mode: 0o700 });
}

function getSystemUsername(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER || process.env.LOGNAME || process.env.USERNAME || "user";
  }
}

/**
 * Derives a deterministic 32-byte AES-256 key from FOTO_MASTER_KEY or host/user identity
 */
function deriveEncryptionKey(): Buffer {
  const secret = process.env.FOTO_MASTER_KEY || `foto-mcp-v3-${os.hostname()}-${getSystemUsername()}`;
  return crypto.scryptSync(secret, "foto-mcp-salt-v3", 32);
}

/**
 * Encrypts a credential payload using AES-256-GCM
 */
export function encryptCredentialsPayload(creds: StoredCredentials): string {
  const key = deriveEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(creds);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts an AES-256-GCM credential payload
 */
export function decryptCredentialsPayload(payload: string): StoredCredentials | null {
  try {
    const parts = payload.split(":");
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, dataHex] = parts;
    const key = deriveEncryptionKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final()
    ]);
    return JSON.parse(decrypted.toString("utf8")) as StoredCredentials;
  } catch {
    return null;
  }
}

async function readProfilesRegistry(): Promise<ProfilesRegistry> {
  try {
    const raw = await fs.readFile(CONFIG_PATHS.profilesFile, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.profiles) {
      return {
        activeProfile: parsed.activeProfile || "default",
        profiles: parsed.profiles
      };
    }
  } catch {
    // Fallback to legacy credentials.json if present
  }

  try {
    const legacyRaw = await fs.readFile(CONFIG_PATHS.credentialsFile, "utf-8");
    const legacyParsed = JSON.parse(legacyRaw);
    if (legacyParsed && legacyParsed.idToken && legacyParsed.userId) {
      return {
        activeProfile: "default",
        profiles: {
          default: legacyParsed
        }
      };
    }
  } catch {
    // Ignore
  }

  return {
    activeProfile: activeProfileName || "default",
    profiles: {}
  };
}

async function writeProfilesRegistry(registry: ProfilesRegistry): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(
    CONFIG_PATHS.profilesFile,
    JSON.stringify(registry, null, 2),
    { encoding: "utf-8", mode: 0o600 }
  );
}

export function getActiveProfileName(): string {
  return activeProfileName;
}

export async function loadStoredCredentials(profileName?: string): Promise<StoredCredentials | null> {
  const targetProfile = profileName || activeProfileName || "default";

  if (inMemoryProfiles.has(targetProfile)) {
    return inMemoryProfiles.get(targetProfile)!;
  }

  const registry = await readProfilesRegistry();
  if (!profileName && registry.activeProfile) {
    activeProfileName = registry.activeProfile;
  }
  const effectiveProfile = profileName || activeProfileName || "default";

  const entry = registry.profiles[effectiveProfile];
  if (entry) {
    if ("__encrypted" in entry && typeof entry.__encrypted === "string") {
      const decrypted = decryptCredentialsPayload(entry.__encrypted);
      if (decrypted && decrypted.idToken && decrypted.userId) {
        decrypted.profileName = effectiveProfile;
        inMemoryProfiles.set(effectiveProfile, decrypted);
        return decrypted;
      }
    } else if ("idToken" in entry && "userId" in entry) {
      const creds = { ...entry, profileName: effectiveProfile };
      inMemoryProfiles.set(effectiveProfile, creds);
      return creds;
    }
  }

  return null;
}

export async function saveCredentials(creds: StoredCredentials, profileName?: string): Promise<void> {
  const targetProfile = (profileName || creds.profileName || activeProfileName || "default").trim();
  const normalizedCreds: StoredCredentials = {
    ...creds,
    profileName: targetProfile
  };

  activeProfileName = targetProfile;
  inMemoryProfiles.set(targetProfile, normalizedCreds);

  await ensureConfigDir();

  // Maintain legacy credentials.json for backward compatibility
  await fs.writeFile(
    CONFIG_PATHS.credentialsFile,
    JSON.stringify(normalizedCreds, null, 2),
    { encoding: "utf-8", mode: 0o600 }
  );

  // Also persist AES-256-GCM encrypted entry in profiles.json
  const registry = await readProfilesRegistry();
  registry.activeProfile = targetProfile;
  registry.profiles[targetProfile] = {
    __encrypted: encryptCredentialsPayload(normalizedCreds)
  };
  await writeProfilesRegistry(registry);
}

export async function clearCredentials(profileName?: string): Promise<void> {
  if (profileName) {
    const target = profileName.trim();
    inMemoryProfiles.delete(target);
    const registry = await readProfilesRegistry();
    delete registry.profiles[target];
    const remaining = Object.keys(registry.profiles);
    if (registry.activeProfile === target) {
      registry.activeProfile = remaining[0] || "default";
      activeProfileName = registry.activeProfile;
    }
    await writeProfilesRegistry(registry);

    if (remaining.length === 0) {
      try {
        await fs.unlink(CONFIG_PATHS.credentialsFile);
      } catch {
        // Ignore
      }
    } else if (registry.activeProfile && registry.profiles[registry.activeProfile]) {
      const newActive = await loadStoredCredentials(registry.activeProfile);
      if (newActive) {
        await fs.writeFile(
          CONFIG_PATHS.credentialsFile,
          JSON.stringify(newActive, null, 2),
          { encoding: "utf-8", mode: 0o600 }
        );
      }
    } else {
      try {
        await fs.unlink(CONFIG_PATHS.credentialsFile);
      } catch {
        // Ignore
      }
    }
    return;
  }

  inMemoryProfiles.clear();
  activeProfileName = "default";
  try {
    await fs.unlink(CONFIG_PATHS.credentialsFile);
  } catch {
    // Ignore if already deleted
  }
  try {
    await fs.unlink(CONFIG_PATHS.profilesFile);
  } catch {
    // Ignore if already deleted
  }
}

/**
 * Lists all saved Foto account profiles and their session statuses.
 */
export async function listProfiles(): Promise<{
  activeProfile: string;
  profiles: ProfileSummary[];
}> {
  const registry = await readProfilesRegistry();
  const currentActive = activeProfileName || registry.activeProfile || "default";
  const profiles: ProfileSummary[] = [];

  const profileNames = new Set<string>([
    ...Object.keys(registry.profiles),
    ...Array.from(inMemoryProfiles.keys())
  ]);

  for (const name of profileNames) {
    const creds = await loadStoredCredentials(name);
    if (creds) {
      const remainingMs = creds.expiresAt - Date.now();
      const expiresInMinutes = Math.max(0, Math.round(remainingMs / 60000));
      profiles.push({
        profileName: name,
        active: name === currentActive,
        userId: creds.userId,
        email: creds.email,
        expiresInMinutes,
        loggedIn: remainingMs > 0 || Boolean(creds.refreshToken)
      });
    }
  }

  return {
    activeProfile: currentActive,
    profiles
  };
}

/**
 * Switches the active Foto account profile.
 */
export async function switchProfile(profileName: string): Promise<{
  success: boolean;
  activeProfile: string;
  userId: string;
  email?: string;
  message: string;
}> {
  if (!profileName || typeof profileName !== "string" || !profileName.trim()) {
    throw new Error("Profile name is required.");
  }
  const target = profileName.trim();
  const creds = await loadStoredCredentials(target);
  if (!creds) {
    throw new Error(`Profile "${target}" not found. Use foto_login with profileName="${target}" to add it first.`);
  }

  activeProfileName = target;
  const registry = await readProfilesRegistry();
  registry.activeProfile = target;
  await writeProfilesRegistry(registry);

  // Sync active credentials to credentials.json
  await fs.writeFile(
    CONFIG_PATHS.credentialsFile,
    JSON.stringify(creds, null, 2),
    { encoding: "utf-8", mode: 0o600 }
  );

  return {
    success: true,
    activeProfile: target,
    userId: creds.userId,
    email: creds.email,
    message: `Switched active Foto profile to "${target}" (${creds.email || creds.userId}).`
  };
}

/**
 * Authenticate with email and password via Firebase Auth REST API
 */
export async function signInWithEmailAndPassword(
  email?: string,
  password?: string,
  profileName?: string
): Promise<StoredCredentials> {
  const finalEmail = email || process.env.FOTO_EMAIL;
  const finalPassword = password || process.env.FOTO_PASSWORD;
  const targetProfile = (profileName || activeProfileName || "default").trim();

  if (!finalEmail || !finalPassword) {
    throw new Error(
      "Missing credentials. Please provide email and password, or set FOTO_EMAIL and FOTO_PASSWORD in your environment."
    );
  }

  const endpoint = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FOTO_FIREBASE_CONFIG.apiKey}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: finalEmail,
      password: finalPassword,
      returnSecureToken: true
    })
  });

  const data = (await res.json()) as any;

  if (!res.ok) {
    const errorMsg = data.error?.message || "Authentication failed";
    if (errorMsg === "INVALID_LOGIN_CREDENTIALS") {
      throw new Error("Invalid Foto email or password. Please verify your credentials.");
    }
    throw new Error(`Foto authentication error: ${errorMsg}`);
  }

  const expiresInSec = parseInt(data.expiresIn || "3600", 10);
  const creds: StoredCredentials = {
    email: data.email || finalEmail,
    userId: data.localId,
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + (expiresInSec - 60) * 1000, // Buffer 60 seconds
    profileName: targetProfile
  };

  await saveCredentials(creds, targetProfile);
  return creds;
}

/**
 * Refresh an existing expired ID token using the refreshToken
 */
export async function refreshIdToken(refreshToken: string, profileName?: string): Promise<StoredCredentials> {
  const endpoint = `https://securetoken.googleapis.com/v1/token?key=${FOTO_FIREBASE_CONFIG.apiKey}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    }).toString()
  });

  const data = (await res.json()) as any;

  if (!res.ok) {
    throw new Error(`Failed to refresh Foto token: ${data.error?.message || "Token refresh error"}`);
  }

  const targetProfile = profileName || activeProfileName || "default";
  const current = (await loadStoredCredentials(targetProfile)) || {
    email: undefined,
    userId: data.user_id,
    refreshToken: data.refresh_token
  };

  const expiresInSec = parseInt(data.expires_in || "3600", 10);
  const updated: StoredCredentials = {
    email: current.email,
    userId: data.user_id,
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (expiresInSec - 60) * 1000,
    profileName: targetProfile
  };

  await saveCredentials(updated, targetProfile);
  return updated;
}

/**
 * Gets a guaranteed valid ID token (automatically refreshing if expired, or signing in via env)
 */
export async function getValidAuthSession(profileName?: string): Promise<StoredCredentials> {
  const targetProfile = profileName || activeProfileName || "default";
  let creds = await loadStoredCredentials(targetProfile);

  // If no stored credentials, try env vars
  if (!creds) {
    if (process.env.FOTO_EMAIL && process.env.FOTO_PASSWORD) {
      return await signInWithEmailAndPassword(undefined, undefined, targetProfile);
    }
    throw new Error(
      "Not authenticated. Please use the `foto_login` tool with your email and password, or set FOTO_EMAIL and FOTO_PASSWORD in your environment."
    );
  }

  // If token is still fresh, return it
  if (Date.now() < creds.expiresAt) {
    return creds;
  }

  // Token expired, refresh it
  if (creds.refreshToken) {
    try {
      return await refreshIdToken(creds.refreshToken, targetProfile);
    } catch {
      // If refresh failed, fall back to email/password if available
      if (process.env.FOTO_EMAIL && process.env.FOTO_PASSWORD) {
        return await signInWithEmailAndPassword(undefined, undefined, targetProfile);
      }
      throw new Error(`Authentication token expired and could not be refreshed. Please run foto_login again.`);
    }
  }

  throw new Error("Stored credentials invalid. Please run foto_login.");
}

/**
 * Returns current login status for inspection
 */
export async function getAuthStatus(profileName?: string): Promise<AuthStatus> {
  const targetProfile = profileName || activeProfileName || "default";
  try {
    const creds = await loadStoredCredentials(targetProfile);
    if (!creds) {
      if (process.env.FOTO_EMAIL) {
        return {
          loggedIn: false,
          activeProfile: targetProfile,
          email: process.env.FOTO_EMAIL,
          message: "Credentials configured in environment but not yet authenticated."
        };
      }
      return {
        loggedIn: false,
        activeProfile: targetProfile,
        message: "No active Foto session found. Please run `foto_login`."
      };
    }

    const remainingMs = creds.expiresAt - Date.now();
    const expiresInMinutes = Math.max(0, Math.round(remainingMs / 60000));

    return {
      loggedIn: true,
      activeProfile: targetProfile,
      email: creds.email,
      userId: creds.userId,
      expiresInMinutes,
      encryptedAtRest: true,
      message: `Authenticated as ${creds.email || creds.userId} on profile "${targetProfile}" (token valid for ~${expiresInMinutes}m).`
    };
  } catch (err: any) {
    return {
      loggedIn: false,
      activeProfile: targetProfile,
      message: err.message
    };
  }
}
