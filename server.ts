import express from "express";
import { mkdir, readFile, writeFile } from "fs/promises";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type StoredMessage = {
  ai_response?: {
    importance_reason: string;
    is_important: boolean;
    reply_to_user: string;
    summary: string;
  };
  from: string;
  id: string;
  text: string;
  timestamp: string;
  to: string;
  type: "incoming" | "outgoing";
};

type AppSettings = {
  personal_phone: string;
  phone_id: string;
  system_prompt: string;
  verify_token: string;
  whatsapp_token: string;
};

type AppState = {
  messages: StoredMessage[];
  settings: AppSettings;
};

const DEFAULT_SETTINGS: AppSettings = {
  system_prompt: "",
  whatsapp_token: "",
  phone_id: "",
  personal_phone: "",
  verify_token: "my_secret_token",
};

const MAX_STORED_MESSAGES = 1000;

function getDataDir(): string {
  const configured = process.env.DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.resolve(__dirname, "data");
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function saveState(statePath: string, state: AppState): Promise<void> {
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}

async function initializeState(): Promise<{ state: AppState; statePath: string }> {
  const dataDir = getDataDir();
  const statePath = path.join(dataDir, "state.json");

  await mkdir(dataDir, { recursive: true });

  const fallbackState: AppState = {
    messages: [],
    settings: DEFAULT_SETTINGS,
  };
  const persisted = await readJsonFile<Partial<AppState>>(statePath, {});

  const state: AppState = {
    messages: Array.isArray(persisted.messages)
      ? (persisted.messages as StoredMessage[])
      : fallbackState.messages,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(persisted.settings ?? {}),
    },
  };

  await saveState(statePath, state);
  return { state, statePath };
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

function parseIncomingMessages(body: any): StoredMessage[] {
  const incoming: StoredMessage[] = [];
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
  const ENV_VERIFY_TOKEN = process.env.VERIFY_TOKEN?.trim();
  const { state, statePath } = await initializeState();

  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  app.get("/api/messages", (req, res) => {
    const limitRaw = Number(req.query.limit);
    const count = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 50;

    const sorted = [...state.messages].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    res.json(sorted.slice(0, count));
  });

  app.get("/api/settings", (_req, res) => {
    res.json(state.settings);
  });

  app.put("/api/settings", async (req, res) => {
    try {
      const payload = req.body ?? {};
      state.settings = {
        system_prompt: typeof payload.system_prompt === "string" ? payload.system_prompt : state.settings.system_prompt,
        whatsapp_token: typeof payload.whatsapp_token === "string" ? payload.whatsapp_token : state.settings.whatsapp_token,
        phone_id: typeof payload.phone_id === "string" ? payload.phone_id : state.settings.phone_id,
        personal_phone: typeof payload.personal_phone === "string" ? payload.personal_phone : state.settings.personal_phone,
        verify_token: typeof payload.verify_token === "string" ? payload.verify_token : state.settings.verify_token,
      };
      await saveState(statePath, state);
      res.json({ ok: true, settings: state.settings });
    } catch (error) {
      console.error("Failed to save settings", error);
      res.status(500).json({ ok: false, error: "Failed to save settings" });
    }
  });

  app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const isSubscribeRequest = mode === "subscribe";
    const hasChallenge = typeof challenge === "string" && challenge.length > 0;
    const effectiveVerifyToken = ENV_VERIFY_TOKEN || state.settings.verify_token;
    const tokenMatches =
      typeof token === "string" &&
      token.length > 0 &&
      (!effectiveVerifyToken || token === effectiveVerifyToken);

    if (isSubscribeRequest && hasChallenge && tokenMatches) {
      return res.status(200).send(challenge);
    }

    return res.status(403).send("Forbidden");
  });

  app.post("/webhook", async (req, res) => {
    const incomingMessages = parseIncomingMessages(req.body);

    if (incomingMessages.length === 0) {
      console.log("Webhook event received with no inbound messages");
      return res.sendStatus(200);
    }

    try {
      for (const message of incomingMessages) {
        const existingIndex = state.messages.findIndex((item) => item.id === message.id);
        if (existingIndex >= 0) {
          state.messages[existingIndex] = { ...state.messages[existingIndex], ...message };
        } else {
          state.messages.push(message);
        }
      }
      state.messages = state.messages
        .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
        .slice(0, MAX_STORED_MESSAGES);
      await saveState(statePath, state);

      console.log(`Stored ${incomingMessages.length} incoming WhatsApp message(s)`);
      res.sendStatus(200);
    } catch (error) {
      console.error("Failed to store incoming WhatsApp messages", error);
      res.sendStatus(500);
    }
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
