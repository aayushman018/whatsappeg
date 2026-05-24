import { readFileSync, existsSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";

const keyPath = path.join(process.cwd(), "serviceAccountKey.json");
const statePath = path.join(process.cwd(), "data", "state.json");

if (!existsSync(keyPath)) {
  console.error("No serviceAccountKey.json found. Ensure it exists in the root directory.");
  process.exit(1);
}

if (!existsSync(statePath)) {
  console.log("No data/state.json found. Nothing to migrate.");
  process.exit(0);
}

const serviceAccount = JSON.parse(readFileSync(keyPath, "utf8"));
initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function migrate() {
  console.log("Starting migration...");
  try {
    const rawState = readFileSync(statePath, "utf8");
    const state = JSON.parse(rawState);

    if (state.settings) {
      await db.collection("settings").doc("global").set(state.settings);
      console.log("Migrated settings.");
    }

    if (Array.isArray(state.messages) && state.messages.length > 0) {
      console.log(`Migrating ${state.messages.length} messages...`);
      const chunkSize = 400;
      let totalMigrated = 0;
      for (let i = 0; i < state.messages.length; i += chunkSize) {
        const chunk = state.messages.slice(i, i + chunkSize);
        const batch = db.batch();
        for (const msg of chunk) {
          batch.set(db.collection("messages").doc(msg.id), msg, { merge: true });
        }
        await batch.commit();
        totalMigrated += chunk.length;
        console.log(`Migrated ${totalMigrated}/${state.messages.length} messages...`);
      }
      console.log("Messages migration complete!");
    } else {
      console.log("No messages to migrate.");
    }
    
    console.log("Migration finished successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

migrate();
