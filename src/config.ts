import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

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
  configDir: path.join(os.homedir(), ".config", "foto-mcp"),
  credentialsFile: path.join(os.homedir(), ".config", "foto-mcp", "credentials.json")
};
