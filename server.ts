import express from "express";
import { readFile } from "fs/promises";
import { cert, getApps, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type NormalizedIncomingMessage = {
  from: string;
  id: string;
  text: string;
  timestamp: string;
  to: string;
  type: "incoming";
};

function parseServiceAccountFromEnv(): ServiceAccount | null {
  try {
    const jsonRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
    if (jsonRaw) {
      return JSON.parse(jsonRaw) as ServiceAccount;
    }

    const base64Raw = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();
    if (base64Raw) {
      const decoded = Buffer.from(base64Raw, "base64").toString("utf-8");
      return JSON.parse(decoded) as ServiceAccount;
    }
  } catch (error) {
    console.error("Failed to parse Firebase service account from env", error);
  }

  return null;
}

async function resolveFirestoreDatabaseId(): Promise<string | null> {
  const fromEnv = process.env.FIRESTORE_DATABASE_ID?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  try {
    const configPath = path.resolve(__dirname, "firebase-applet-config.json");
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as { firestoreDatabaseId?: string };
    return parsed.firestoreDatabaseId?.trim() || null;
  } catch {
    return null;
  }
}

async function createFirestoreAdminClient() {
  if (getApps().length === 0) {
    const serviceAccount = parseServiceAccountFromEnv();
    if (serviceAccount) {
      initializeApp({ credential: cert(serviceAccount) });
    } else {
      initializeApp();
    }
  }

  const dbId = await resolveFirestoreDatabaseId();
  const adminApp = getApps()[0];
  return dbId ? getFirestore(adminApp, dbId) : getFirestore(adminApp);
}

function extractMessageText(message: any): string {
  if (typeof message?.text?.body === "string" && message.text.body.trim().length > 0) {
    return message.text.body;
  }

  if (message?.type === "image") {
    return typeof message?.image?.caption === "string" && message.image.caption.trim().length > 0
      ? message.image.caption
      : "[Image message]";
  }

  if (message?.type === "video") {
    return typeof message?.video?.caption === "string" && message.video.caption.trim().length > 0
      ? message.video.caption
      : "[Video message]";
  }

  if (message?.type === "audio") {
    return "[Audio message]";
  }

  if (message?.type === "document") {
    return typeof message?.document?.caption === "string" && message.document.caption.trim().length > 0
      ? message.document.caption
      : "[Document message]";
  }

  if (message?.type === "sticker") {
    return "[Sticker message]";
  }

  return `[Unsupported message type: ${String(message?.type ?? "unknown")}]`;
}

function parseIncomingMessages(body: any): NormalizedIncomingMessage[] {
  const incoming: NormalizedIncomingMessage[] = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      const metadata = value?.metadata ?? {};
      const toNumber =
        typeof metadata?.display_phone_number === "string"
          ? metadata.display_phone_number
          : typeof metadata?.phone_number_id === "string"
          ? metadata.phone_number_id
          : "";
      const messages = Array.isArray(value?.messages) ? value.messages : [];

      for (const message of messages) {
        if (!message || typeof message.from !== "string" || message.from.length === 0) {
          continue;
        }

        const timestampSeconds =
          typeof message.timestamp === "string" ? Number(message.timestamp) : Number.NaN;
        const timestamp = Number.isFinite(timestampSeconds)
          ? new Date(timestampSeconds * 1000).toISOString()
          : new Date().toISOString();
        const messageId =
          typeof message.id === "string" && message.id.length > 0
            ? message.id
            : `${message.from}-${timestamp}`;

        incoming.push({
          id: messageId,
          from: message.from,
          to: toNumber,
          text: extractMessageText(message),
          timestamp,
          type: "incoming",
        });
      }
    }
  }

  return incoming;
}

async function startServer() {
  console.log("--- Simple Server Start ---");
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN?.trim();
  const adminDb = await createFirestoreAdminClient();

  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const isSubscribeRequest = mode === "subscribe";
    const hasChallenge = typeof challenge === "string" && challenge.length > 0;
    const tokenMatches =
      typeof token === "string" &&
      token.length > 0 &&
      (!VERIFY_TOKEN || token === VERIFY_TOKEN);

    if (isSubscribeRequest && hasChallenge && tokenMatches) {
      return res.status(200).send(challenge);
    }

    return res.status(403).send("Forbidden");
  });

  app.post("/webhook", (req, res) => {
    const incomingMessages = parseIncomingMessages(req.body);

    if (incomingMessages.length === 0) {
      console.log("Webhook event received with no inbound messages");
      return res.sendStatus(200);
    }

    Promise.all(
      incomingMessages.map((message) =>
        adminDb.collection("messages").doc(message.id).set(message, { merge: true })
      )
    )
      .then(() => {
        console.log(`Stored ${incomingMessages.length} incoming WhatsApp message(s)`);
        res.sendStatus(200);
      })
      .catch((error) => {
        console.error("Failed to store incoming WhatsApp messages", error);
        res.sendStatus(500);
      });
  });

  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      allowedHosts: true,
    },
    appType: "spa",
  });
  app.use(vite.middlewares);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Fatal startup error:", err);
});
