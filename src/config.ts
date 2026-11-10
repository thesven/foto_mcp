import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(__dirname, "..", "package.json");
const pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string };

export const SERVER_VERSION = pkgJson.version || "3.0.0";

export const FOTO_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAzY7D38b_8Eqr49H8fmptHEN39bPy35lw",
  projectId: "foto-d963e",
  authDomain: "foto-d963e.firebaseapp.com",
  storageBucket: "foto-d963e.appspot.com",
  messagingSenderId: "191456485551",
  appId: "1:191456485551:web:193230d029d759db22f45a",
  measurementId: "G-CQW7C6VG02",
  region: "us-central1"
};

export const SIGHTENGINE_CONFIG = {
  endpoint: "https://api.sightengine.com/1.0/check.json",
  apiUser: "1442869154",
  apiSecret: "7uL7sb2Tyfm6SFwmkTBDAr9KDnXDQwU3",
  models: "nudity-2.1"
};

export const PLATFORM_LIMITS = {
  maxDimension: 1820,
  jpegQuality: 80,
  maxTags: 3,
  minTags: 1,
  maxSeriesImages: 5,
  minSeriesImages: 2,
  maxShardPostCount: 15000,
  sightengineMaxSexualActivity: 0.7,
  sightengineMaxSexualDisplay: 0.9
};

export const CONFIG_PATHS = {
  get configDir(): string {
    return process.env.FOTO_CONFIG_DIR || path.join(os.homedir(), ".config", "foto-mcp");
  },
  get credentialsFile(): string {
    return path.join(this.configDir, "credentials.json");
  },
  get profilesFile(): string {
    return path.join(this.configDir, "profiles.json");
  },
  get draftQueueFile(): string {
    return path.join(this.configDir, "draft-queue.json");
  }
};

