import { signInWithEmailAndPassword, getAuthStatus } from "../src/api/auth.js";
import { fetchUserProfile } from "../src/api/firestore.js";

async function run() {
  console.log("=== Testing Foto Live Authentication ===");
  const email = process.env.FOTO_EMAIL || "michael@mikesvendsen.net";
  const password = process.env.FOTO_PASSWORD;

  try {
    let creds;
    if (password) {
      console.log(`Attempting sign-in for: ${email}`);
      creds = await signInWithEmailAndPassword(email, password);
      console.log("Sign-in SUCCESS!");
    } else {
      console.log("Checking cached authentication session...");
      creds = await signInWithEmailAndPassword(email, "placeholder").catch(async () => {
        const { getValidAuthSession } = await import("../src/api/auth.js");
        return await getValidAuthSession();
      });
      console.log("Authenticated using cached session!");
    }
    console.log("User ID:", creds.userId);
    console.log("ID Token:", creds.idToken.slice(0, 20) + "...");
    console.log("Expires At:", new Date(creds.expiresAt).toISOString());

    const status = await getAuthStatus();
    console.log("Auth Status Check:", status);

    console.log("\nFetching user profile from Firestore...");
    const profile = await fetchUserProfile({
      userId: creds.userId,
      idToken: creds.idToken
    });

    console.log("User Profile retrieved successfully:");
    console.log(JSON.stringify(profile, null, 2));

  } catch (err: any) {
    console.error("Authentication/Profile fetch failed:", err.message || err);
    process.exit(1);
  }
}

run();
