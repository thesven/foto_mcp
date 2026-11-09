import fs from "node:fs/promises";
import path from "node:path";
import { FOTO_FIREBASE_CONFIG, CONFIG_PATHS } from "../config.js";

export interface StoredCredentials {
  email?: string;
  userId: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp ms
}

export interface AuthStatus {
  loggedIn: boolean;
  email?: string;
  userId?: string;
  expiresInMinutes?: number;
  message?: string;
}

let inMemoryCredentials: StoredCredentials | null = null;

async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(CONFIG_PATHS.configDir, { recursive: true, mode: 0o700 });
}

export async function loadStoredCredentials(): Promise<StoredCredentials | null> {
  if (inMemoryCredentials) {
    return inMemoryCredentials;
  }

  try {
    const raw = await fs.readFile(CONFIG_PATHS.credentialsFile, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.idToken && parsed.userId) {
      inMemoryCredentials = parsed;
      return parsed;
    }
  } catch (err) {
    // File doesn't exist or is invalid
  }

  return null;
}

export async function saveCredentials(creds: StoredCredentials): Promise<void> {
  inMemoryCredentials = creds;
  await ensureConfigDir();
  await fs.writeFile(
    CONFIG_PATHS.credentialsFile,
    JSON.stringify(creds, null, 2),
    { encoding: "utf-8", mode: 0o600 }
  );
}

export async function clearCredentials(): Promise<void> {
  inMemoryCredentials = null;
  try {
    await fs.unlink(CONFIG_PATHS.credentialsFile);
  } catch (err) {
    // Ignore if already deleted
  }
}

/**
 * Authenticate with email and password via Firebase Auth REST API
 */
export async function signInWithEmailAndPassword(
  email?: string,
  password?: string
): Promise<StoredCredentials> {
  const finalEmail = email || process.env.FOTO_EMAIL;
  const finalPassword = password || process.env.FOTO_PASSWORD;

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
    expiresAt: Date.now() + (expiresInSec - 60) * 1000 // Buffer 60 seconds
  };

  await saveCredentials(creds);
  return creds;
}

/**
 * Refresh an existing expired ID token using the refreshToken
 */
export async function refreshIdToken(refreshToken: string): Promise<StoredCredentials> {
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

  const current = (await loadStoredCredentials()) || {
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
    expiresAt: Date.now() + (expiresInSec - 60) * 1000
  };

  await saveCredentials(updated);
  return updated;
}

/**
 * Gets a guaranteed valid ID token (automatically refreshing if expired, or signing in via env)
 */
export async function getValidAuthSession(): Promise<StoredCredentials> {
  let creds = await loadStoredCredentials();

  // If no stored credentials, try env vars
  if (!creds) {
    if (process.env.FOTO_EMAIL && process.env.FOTO_PASSWORD) {
      return await signInWithEmailAndPassword();
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
      return await refreshIdToken(creds.refreshToken);
    } catch (err) {
      // If refresh failed, fall back to email/password if available
      if (process.env.FOTO_EMAIL && process.env.FOTO_PASSWORD) {
        return await signInWithEmailAndPassword();
      }
      throw new Error(`Authentication token expired and could not be refreshed. Please run foto_login again.`);
    }
  }

  throw new Error("Stored credentials invalid. Please run foto_login.");
}

/**
 * Returns current login status for inspection
 */
export async function getAuthStatus(): Promise<AuthStatus> {
  try {
    const creds = await loadStoredCredentials();
    if (!creds) {
      if (process.env.FOTO_EMAIL) {
        return {
          loggedIn: false,
          email: process.env.FOTO_EMAIL,
          message: "Credentials configured in environment but not yet authenticated."
        };
      }
      return {
        loggedIn: false,
        message: "No active Foto session found. Please run `foto_login`."
      };
    }

    const remainingMs = creds.expiresAt - Date.now();
    const expiresInMinutes = Math.max(0, Math.round(remainingMs / 60000));

    return {
      loggedIn: true,
      email: creds.email,
      userId: creds.userId,
      expiresInMinutes,
      message: `Authenticated as ${creds.email || creds.userId} (token valid for ~${expiresInMinutes}m).`
    };
  } catch (err: any) {
    return {
      loggedIn: false,
      message: err.message
    };
  }
}
