import express from "express";
import axios from "axios";
import { mkdir, readFile, writeFile } from "fs/promises";
import { GoogleGenAI } from "@google/genai";
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
  contact_name?: string;
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
  whatsapp_business_id: string;
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
  whatsapp_business_id: "",
  personal_phone: "",
  verify_token: "my_secret_token",
};

const MAX_STORED_MESSAGES = 1000;
const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful WhatsApp assistant for a business. Reply briefly, clearly, and politely.";

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

function parseIncomingMessages(body: any, expectedBusinessId?: string): StoredMessage[] {
  const incoming: StoredMessage[] = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];

  for (const entry of entries) {
    if (
      expectedBusinessId &&
      typeof entry?.id === "string" &&
      entry.id.length > 0 &&
      entry.id !== expectedBusinessId
    ) {
      continue;
    }

    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      const metadata = value?.metadata ?? {};
      const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
      const contactNameByWaId = new Map<string, string>();
      for (const contact of contacts) {
        if (typeof contact?.wa_id !== "string") {
          continue;
        }
        const profileName =
          typeof contact?.profile?.name === "string" ? contact.profile.name.trim() : "";
        if (profileName.length > 0) {
          contactNameByWaId.set(contact.wa_id, profileName);
        }
      }
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
          contact_name: contactNameByWaId.get(message.from),
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

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  const lines = trimmed.split("\n");
  if (lines.length <= 2) {
    return trimmed;
  }
  return lines.slice(1, -1).join("\n").trim();
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

function normalizeAiResult(
  parsed: Partial<NonNullable<StoredMessage["ai_response"]>> | null,
  fallbackReply: string
): NonNullable<StoredMessage["ai_response"]> {
  const reply =
    typeof parsed?.reply_to_user === "string" && parsed.reply_to_user.trim().length > 0
      ? parsed.reply_to_user.trim()
      : fallbackReply;
  const isImportant = Boolean(parsed?.is_important);
  const importanceReason =
    typeof parsed?.importance_reason === "string" && parsed.importance_reason.trim().length > 0
      ? parsed.importance_reason.trim()
      : isImportant
      ? "Marked important by AI"
      : "No urgent signal detected";
  const summary =
    typeof parsed?.summary === "string" && parsed.summary.trim().length > 0
      ? parsed.summary.trim()
      : "Auto-generated reply";

  return {
    reply_to_user: reply,
    is_important: isImportant,
    importance_reason: importanceReason,
    summary,
  };
}

async function generateAiResponse(
  incomingText: string,
  systemPrompt: string
): Promise<NonNullable<StoredMessage["ai_response"]>> {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  const fallbackReply = "Thanks for your message. We received it and will get back to you shortly.";

  if (!apiKey) {
    return {
      reply_to_user: fallbackReply,
      is_important: false,
      importance_reason: "GEMINI_API_KEY is missing; used fallback reply.",
      summary: incomingText.slice(0, 140),
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";

    const response = await ai.models.generateContent({
      model,
      contents:
        [
          "Return ONLY JSON object with keys:",
          "reply_to_user (string),",
          "is_important (boolean),",
          "importance_reason (string),",
          "summary (string).",
          "",
          `System prompt: ${systemPrompt || DEFAULT_SYSTEM_PROMPT}`,
          `Incoming user message: ${incomingText}`,
        ].join("\n"),
    });

    const text = (response.text ?? "").trim();
    const withoutFence = stripCodeFences(text);
    const parsedDirect = safeJsonParse<Partial<NonNullable<StoredMessage["ai_response"]>>>(withoutFence);
    if (parsedDirect) {
      return normalizeAiResult(parsedDirect, fallbackReply);
    }

    const extracted = extractFirstJsonObject(withoutFence);
    if (extracted) {
      const parsedExtracted = safeJsonParse<Partial<NonNullable<StoredMessage["ai_response"]>>>(
        extracted
      );
      if (parsedExtracted) {
        return normalizeAiResult(parsedExtracted, fallbackReply);
      }
    }

    return normalizeAiResult(null, text || fallbackReply);
  } catch (error) {
    console.error("Failed to generate AI response", error);
    return {
      reply_to_user: fallbackReply,
      is_important: false,
      importance_reason: "AI generation failed; used fallback reply.",
      summary: incomingText.slice(0, 140),
    };
  }
}

async function sendWhatsAppMessage(
  to: string,
  replyText: string,
  phoneId: string,
  whatsappToken: string
): Promise<string | null> {
  const apiVersion = process.env.WHATSAPP_API_VERSION?.trim() || "v20.0";
  const endpoint = `https://graph.facebook.com/${apiVersion}/${phoneId}/messages`;

  const resp = await axios.post(
    endpoint,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: {
        body: replyText,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${whatsappToken}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );

  const sentId = resp.data?.messages?.[0]?.id;
  return typeof sentId === "string" ? sentId : null;
}

async function autoReplyToIncomingMessages(
  messagesToReply: StoredMessage[],
  state: AppState,
  statePath: string,
  runtimeSettings: {
    phoneId: string;
    whatsappToken: string;
    systemPrompt: string;
  }
): Promise<void> {
  if (!runtimeSettings.whatsappToken || !runtimeSettings.phoneId) {
    console.warn(
      "Auto-reply skipped because whatsapp_token or phone_id is missing in settings/environment."
    );
    return;
  }

  for (const incomingMessage of messagesToReply) {
    try {
      const aiResponse = await generateAiResponse(
        incomingMessage.text,
        runtimeSettings.systemPrompt || DEFAULT_SYSTEM_PROMPT
      );

      await sendWhatsAppMessage(
        incomingMessage.from,
        aiResponse.reply_to_user,
        runtimeSettings.phoneId,
        runtimeSettings.whatsappToken
      );

      const idx = state.messages.findIndex((m) => m.id === incomingMessage.id);
      if (idx >= 0) {
        state.messages[idx] = {
          ...state.messages[idx],
          ai_response: aiResponse,
        };
      }
      await saveState(statePath, state);
      console.log(`Auto-replied to message ${incomingMessage.id}`);
    } catch (error) {
      console.error(`Failed auto-reply for message ${incomingMessage.id}`, error);
    }
  }
}

async function startServer() {
  console.log("--- Simple Server Start ---");
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const ENV_VERIFY_TOKEN = process.env.VERIFY_TOKEN?.trim();
  const ENV_WHATSAPP_BUSINESS_ID = process.env.WHATSAPP_BUSINESS_ID?.trim();
  const ENV_WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN?.trim();
  const ENV_PHONE_ID = process.env.PHONE_ID?.trim();
  const ENV_SYSTEM_PROMPT = process.env.SYSTEM_PROMPT?.trim();
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
        whatsapp_business_id:
          typeof payload.whatsapp_business_id === "string"
            ? payload.whatsapp_business_id
            : state.settings.whatsapp_business_id,
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
    const effectiveBusinessId = ENV_WHATSAPP_BUSINESS_ID || state.settings.whatsapp_business_id;
    const incomingMessages = parseIncomingMessages(req.body, effectiveBusinessId || undefined);

    if (incomingMessages.length === 0) {
      if (effectiveBusinessId) {
        console.log(
          `Webhook event received with no inbound messages for business id ${effectiveBusinessId}`
        );
      } else {
        console.log("Webhook event received with no inbound messages");
      }
      return res.sendStatus(200);
    }

    try {
      const newlyStoredIncoming: StoredMessage[] = [];
      for (const message of incomingMessages) {
        const existingIndex = state.messages.findIndex((item) => item.id === message.id);
        if (existingIndex >= 0) {
          state.messages[existingIndex] = { ...state.messages[existingIndex], ...message };
        } else {
          state.messages.push(message);
          newlyStoredIncoming.push(message);
        }
      }
      state.messages = state.messages
        .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
        .slice(0, MAX_STORED_MESSAGES);
      await saveState(statePath, state);

      console.log(`Stored ${incomingMessages.length} incoming WhatsApp message(s)`);
      res.sendStatus(200);

      if (newlyStoredIncoming.length > 0) {
        const runtimeSettings = {
          whatsappToken: ENV_WHATSAPP_TOKEN || state.settings.whatsapp_token,
          phoneId: ENV_PHONE_ID || state.settings.phone_id,
          systemPrompt: ENV_SYSTEM_PROMPT || state.settings.system_prompt,
        };
        void autoReplyToIncomingMessages(newlyStoredIncoming, state, statePath, runtimeSettings);
      }
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
