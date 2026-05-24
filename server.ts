import express from "express";
import axios from "axios";
import crypto from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

import { readFileSync, existsSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db: any = null;
try {
  const keyPath = path.join(__dirname, "serviceAccountKey.json");
  if (existsSync(keyPath)) {
    const serviceAccount = JSON.parse(readFileSync(keyPath, "utf8"));
    initializeApp({
      credential: cert(serviceAccount)
    });
    db = getFirestore();
    console.log("Firebase Admin initialized with service account.");
  } else {
    console.warn("serviceAccountKey.json not found, Firebase Admin not initialized.");
  }
} catch (error) {
  console.error("Error initializing Firebase Admin:", error);
}

type StoredMessage = {
  ai_response?: {
    importance_reason: string;
    is_important: boolean;
    lead_score: number;
    reply_to_user: string;
    summary: string;
  };
  contact_name?: string;
  from: string;
  id: string;
  is_priority?: boolean;
  priority_reasons?: string[];
  reply_source?: "ai" | "manual";
  text: string;
  timestamp: string;
  to: string;
  type: "incoming" | "outgoing";
};

type ContactConfig = {
  ai_enabled: boolean;
  label: string;
  last_contact_name?: string;
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
  contacts: Record<string, ContactConfig>;
  meta?: {
    last_daily_summary_date?: string;
  };
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
const DEFAULT_CONTACT_CONFIG: ContactConfig = {
  ai_enabled: true,
  label: "",
};
const DEFAULT_PRIORITY_KEYWORDS = ["urgent", "price", "asap", "immediately", "emergency"];
const DAILY_SUMMARY_TARGET_HOUR = 9;
const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful WhatsApp assistant for a business. Reply briefly, clearly, and politely.";
const SESSION_COOKIE_NAME = "waintel_session";
const DEFAULT_SESSION_TTL_HOURS = 24 * 7;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

type SessionRecord = {
  createdAt: number;
  email: string;
  expiresAt: number;
};

type LoginAttemptRecord = {
  count: number;
  resetAt: number;
};

type GoogleSheetsSyncPayload = {
  event: "message" | "lead";
  ai_enabled?: boolean;
  contact_label?: string;
  contact_name?: string;
  from: string;
  importance_reason?: string;
  is_priority?: boolean;
  lead_score?: number;
  message_id: string;
  message_text: string;
  timestamp: string;
  to: string;
};

const sessionStore = new Map<string, SessionRecord>();
const loginAttemptStore = new Map<string, LoginAttemptRecord>();
let stateWriteQueue: Promise<void> = Promise.resolve();

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }
  const cookies: Record<string, string> = {};
  for (const segment of cookieHeader.split(";")) {
    const sep = segment.indexOf("=");
    if (sep < 0) {
      continue;
    }
    const key = segment.slice(0, sep).trim();
    const value = segment.slice(sep + 1).trim();
    if (!key) {
      continue;
    }
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

function getSessionTtlMs(): number {
  const hoursRaw = Number(process.env.SESSION_TTL_HOURS);
  const hours =
    Number.isFinite(hoursRaw) && hoursRaw > 0 ? Math.min(hoursRaw, 24 * 30) : DEFAULT_SESSION_TTL_HOURS;
  return Math.floor(hours * 60 * 60 * 1000);
}

function createSession(email: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  sessionStore.set(token, {
    email,
    createdAt: now,
    expiresAt: now + getSessionTtlMs(),
  });
  return token;
}

function getSessionFromRequest(req: express.Request): SessionRecord | null {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }
  const session = sessionStore.get(token);
  if (!session) {
    return null;
  }
  if (session.expiresAt <= Date.now()) {
    sessionStore.delete(token);
    return null;
  }
  return session;
}

function clearSessionFromRequest(req: express.Request): void {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
  if (token) {
    sessionStore.delete(token);
  }
}

function getClientKey(req: express.Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function isLoginRateLimited(clientKey: string): { limited: boolean; retryAfterSec: number } {
  const now = Date.now();
  const record = loginAttemptStore.get(clientKey);
  if (!record) {
    return { limited: false, retryAfterSec: 0 };
  }
  if (now > record.resetAt) {
    loginAttemptStore.delete(clientKey);
    return { limited: false, retryAfterSec: 0 };
  }
  if (record.count < LOGIN_MAX_ATTEMPTS) {
    return { limited: false, retryAfterSec: 0 };
  }
  return {
    limited: true,
    retryAfterSec: Math.ceil((record.resetAt - now) / 1000),
  };
}

function trackFailedLogin(clientKey: string): void {
  const now = Date.now();
  const current = loginAttemptStore.get(clientKey);
  if (!current || now > current.resetAt) {
    loginAttemptStore.set(clientKey, {
      count: 1,
      resetAt: now + LOGIN_WINDOW_MS,
    });
    return;
  }
  current.count += 1;
  loginAttemptStore.set(clientKey, current);
}

function clearFailedLogin(clientKey: string): void {
  loginAttemptStore.delete(clientKey);
}

function secureEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf-8");
  const bBuf = Buffer.from(b, "utf-8");
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function getDataDir(): string {
  const configured = process.env.DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.resolve(__dirname, "data");
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn(`Failed reading JSON file: ${filePath}`, error);
    }
    return fallback;
  }
}

async function loadPersistedState(statePath: string): Promise<Partial<AppState>> {
  if (db) {
    try {
      const stateObj: Partial<AppState> = {};
      const settingsDoc = await db.collection("settings").doc("global").get();
      if (settingsDoc.exists) {
        stateObj.settings = settingsDoc.data() as AppSettings;
      }
      
      const messagesSnapshot = await db.collection("messages").orderBy("timestamp", "desc").limit(MAX_STORED_MESSAGES).get();
      const messages: StoredMessage[] = [];
      messagesSnapshot.forEach((doc: any) => {
        messages.push(doc.data() as StoredMessage);
      });
      if (messages.length > 0) {
        stateObj.messages = sortMessagesNewestFirst(messages);
      }
      
      if (stateObj.settings || stateObj.messages) {
        console.log("State loaded successfully from Firestore.");
        return stateObj;
      }
    } catch (e) {
      console.error("Failed loading state from Firestore, falling back to local file:", e);
    }
  }

  const main = await readJsonFile<Partial<AppState> | null>(statePath, null);
  if (main && typeof main === "object") {
    return main;
  }

  const backupPath = `${statePath}.bak`;
  const backup = await readJsonFile<Partial<AppState> | null>(backupPath, null);
  if (backup && typeof backup === "object") {
    console.warn("Recovered app state from backup file.");
    return backup;
  }

  return {};
}

async function saveState(statePath: string, state: AppState): Promise<void> {
  const payload = JSON.stringify(state, null, 2);
  const tmpPath = `${statePath}.tmp`;
  const backupPath = `${statePath}.bak`;
  stateWriteQueue = stateWriteQueue
    .catch(() => {
      // Keep queue alive even after a previous write failure.
    })
    .then(async () => {
      await writeFile(tmpPath, payload, "utf-8");
      await rename(tmpPath, statePath);
      await writeFile(backupPath, payload, "utf-8");
      
      if (db && state.settings) {
        try {
          await db.collection("settings").doc("global").set(state.settings);
        } catch (e) {
          console.error("Failed to sync settings to Firestore:", e);
        }
      }
    });
  await stateWriteQueue;
}

async function initializeState(): Promise<{ state: AppState; statePath: string }> {
  const dataDir = getDataDir();
  const statePath = path.join(dataDir, "state.json");

  await mkdir(dataDir, { recursive: true });

  const fallbackState: AppState = {
    contacts: {},
    messages: [],
    settings: DEFAULT_SETTINGS,
    meta: {},
  };
  const persisted = await loadPersistedState(statePath);

  const state: AppState = {
    contacts:
      persisted.contacts && typeof persisted.contacts === "object"
        ? (persisted.contacts as Record<string, ContactConfig>)
        : fallbackState.contacts,
    messages: Array.isArray(persisted.messages)
      ? (persisted.messages as StoredMessage[])
      : fallbackState.messages,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(persisted.settings ?? {}),
    },
    meta:
      persisted.meta && typeof persisted.meta === "object"
        ? (persisted.meta as AppState["meta"])
        : fallbackState.meta,
  };

  await saveState(statePath, state);
  return { state, statePath };
}

function normalizePhone(phone: string): string {
  return phone.replace(/\s+/g, "").trim();
}

function getContactConfig(state: AppState, phone: string, contactName?: string): ContactConfig {
  const key = normalizePhone(phone);
  const existing = state.contacts[key];
  if (existing) {
    if (contactName && contactName.trim().length > 0 && existing.last_contact_name !== contactName.trim()) {
      existing.last_contact_name = contactName.trim();
    }
    return existing;
  }

  const created: ContactConfig = {
    ...DEFAULT_CONTACT_CONFIG,
    ...(contactName && contactName.trim().length > 0 ? { last_contact_name: contactName.trim() } : {}),
  };
  state.contacts[key] = created;
  return created;
}

function parsePriorityKeywords(): string[] {
  const configured = process.env.PRIORITY_KEYWORDS?.trim();
  if (!configured) {
    return DEFAULT_PRIORITY_KEYWORDS;
  }
  const parsed = configured
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
  return parsed.length > 0 ? parsed : DEFAULT_PRIORITY_KEYWORDS;
}

function detectPriorityReasons(text: string, keywords: string[]): string[] {
  const lowered = text.toLowerCase();
  return keywords.filter((keyword) => lowered.includes(keyword));
}

function sortMessagesNewestFirst(messages: StoredMessage[]): StoredMessage[] {
  return messages.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

function pruneMessages(messages: StoredMessage[]): StoredMessage[] {
  return sortMessagesNewestFirst(messages).slice(0, MAX_STORED_MESSAGES);
}

async function syncToGoogleSheets(payload: GoogleSheetsSyncPayload): Promise<void> {
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return;
  }

  try {
    const secret = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET?.trim();
    await axios.post(
      webhookUrl,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          ...(secret ? { "x-sheets-secret": secret } : {}),
        },
        timeout: 12000,
      }
    );
  } catch (error) {
    console.error("Google Sheets sync failed", error);
  }
}

function getDateKey(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  });
  return formatter.format(date);
}

function getHourMinuteInZone(date: Date, timeZone: string): { hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return { hour, minute };
}

function getYesterdayRangeInZone(now: Date, timeZone: string): { startMs: number; endMs: number } {
  const dateKey = getDateKey(now, timeZone);
  const [yearStr, monthStr, dayStr] = dateKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const endMs = utcMidnight;
  const startMs = endMs - 24 * 60 * 60 * 1000;
  return { startMs, endMs };
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

function normalizeSuggestionList(raw: unknown, count: number): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const unique = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const cleaned = item.trim();
    if (!cleaned) {
      continue;
    }
    unique.add(cleaned);
    if (unique.size >= count) {
      break;
    }
  }
  return Array.from(unique.values());
}

function buildConversationMemory(messages: StoredMessage[], limit = 25): string {
  if (messages.length === 0) {
    return "No prior conversation history.";
  }
  const sorted = [...messages].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const recent = sorted.slice(-limit);
  return recent
    .map((message) => {
      const role = message.type === "incoming" ? "User" : "Assistant";
      return `${role}: ${message.text}`;
    })
    .join("\n");
}

function looksLikeGreeting(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /^(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(normalized);
}

function hasRecentAssistantGreeting(messages: StoredMessage[], withinHours = 24): boolean {
  const cutoffMs = Date.now() - withinHours * 60 * 60 * 1000;
  return messages.some((message) => {
    if (message.type !== "outgoing") {
      return false;
    }
    const ts = Date.parse(message.timestamp);
    if (!Number.isFinite(ts) || ts < cutoffMs) {
      return false;
    }
    return looksLikeGreeting(message.text);
  });
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
  const parsedLeadScore = Number(parsed?.lead_score);
  const leadScore =
    Number.isFinite(parsedLeadScore) && parsedLeadScore >= 1 && parsedLeadScore <= 10
      ? Math.round(parsedLeadScore)
      : 5;

  return {
    reply_to_user: reply,
    is_important: isImportant,
    importance_reason: importanceReason,
    lead_score: leadScore,
    summary,
  };
}

async function generateAiResponse(
  incomingText: string,
  systemPrompt: string,
  conversationHistory: StoredMessage[],
  options?: {
    avoidGreeting?: boolean;
  }
): Promise<NonNullable<StoredMessage["ai_response"]>> {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  const fallbackReply = "Thanks for your message. We received it and will get back to you shortly.";

  if (!apiKey) {
    return {
      reply_to_user: fallbackReply,
      is_important: false,
      importance_reason: "GEMINI_API_KEY is missing; used fallback reply.",
      lead_score: 5,
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
          "You are continuing an ongoing WhatsApp conversation.",
          "Do not repeat greetings if the conversation is already active.",
          options?.avoidGreeting
            ? "Greeting rule: DO NOT start with hi/hello/hey in this reply."
            : "Greeting rule: A greeting is optional only if this is a fresh chat.",
          "",
          "Return ONLY JSON object with keys:",
          "reply_to_user (string),",
          "is_important (boolean),",
          "importance_reason (string),",
          "lead_score (number 1-10),",
          "summary (string).",
          "",
          `System prompt: ${systemPrompt || DEFAULT_SYSTEM_PROMPT}`,
          "",
          "Recent conversation context (last 25 messages):",
          buildConversationMemory(conversationHistory, 25),
          "",
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
      lead_score: 5,
      summary: incomingText.slice(0, 140),
    };
  }
}

async function generateManualReplySuggestions(
  conversationHistory: StoredMessage[],
  systemPrompt: string,
  count: number
): Promise<string[]> {
  const fallback = [
    "Thank you for your message. Let me check this and get back shortly.",
    "Got it. Could you please share a little more detail so I can help better?",
    "Understood. I have noted this and will update you soon.",
  ].slice(0, count);

  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!apiKey) {
    return fallback;
  }

  const avoidGreeting = hasRecentAssistantGreeting(conversationHistory, 24);
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";
  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        "Create concise manual-reply suggestions for a human operator in an ongoing WhatsApp chat.",
        "Return ONLY JSON object: {\"suggestions\": [\"...\", \"...\", \"...\"]}",
        `Provide exactly ${count} suggestions.`,
        avoidGreeting
          ? "Do not start with greetings (hi/hello/hey)."
          : "Greeting can be used only if clearly a fresh conversation.",
        `System prompt context: ${systemPrompt || DEFAULT_SYSTEM_PROMPT}`,
        "",
        "Conversation context (last 25 messages):",
        buildConversationMemory(conversationHistory, 25),
      ].join("\n"),
    });

    const text = (response.text ?? "").trim();
    const withoutFence = stripCodeFences(text);
    const parsedDirect = safeJsonParse<{ suggestions?: unknown }>(withoutFence);
    if (parsedDirect) {
      const normalized = normalizeSuggestionList(parsedDirect.suggestions, count);
      if (normalized.length > 0) {
        return normalized;
      }
    }

    const extracted = extractFirstJsonObject(withoutFence);
    if (extracted) {
      const parsedExtracted = safeJsonParse<{ suggestions?: unknown }>(extracted);
      if (parsedExtracted) {
        const normalized = normalizeSuggestionList(parsedExtracted.suggestions, count);
        if (normalized.length > 0) {
          return normalized;
        }
      }
    }

    const roughLines = withoutFence
      .split("\n")
      .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
      .filter((line) => line.length > 0);
    const rough = normalizeSuggestionList(roughLines, count);
    return rough.length > 0 ? rough : fallback;
  } catch (error) {
    console.error("Failed to generate manual reply suggestions", error);
    return fallback;
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

function upsertStoredMessage(state: AppState, message: StoredMessage): void {
  const idx = state.messages.findIndex((existing) => existing.id === message.id);
  if (idx >= 0) {
    state.messages[idx] = { ...state.messages[idx], ...message };
  } else {
    state.messages.push(message);
  }
  
  const mergedMsg = state.messages[idx >= 0 ? idx : state.messages.length - 1];
  if (db) {
    db.collection("messages").doc(mergedMsg.id).set(mergedMsg, { merge: true }).catch((err: any) => console.error("Firestore sync error:", err));
  }
}

async function autoReplyToIncomingMessages(
  messagesToReply: StoredMessage[],
  state: AppState,
  statePath: string,
  runtimeSettings: {
    leadNotifyThreshold: number;
    personalPhone: string;
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
      const contactConfig = getContactConfig(
        state,
        incomingMessage.from,
        incomingMessage.contact_name
      );
      if (!contactConfig.ai_enabled) {
        continue;
      }

      const sameThreadMessages = state.messages.filter(
        (message) => normalizePhone(message.from) === normalizePhone(incomingMessage.from)
      );
      const avoidGreeting = hasRecentAssistantGreeting(sameThreadMessages, 24);
      let aiResponse = await generateAiResponse(
        incomingMessage.text,
        runtimeSettings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        sameThreadMessages,
        { avoidGreeting }
      );
      if (avoidGreeting && looksLikeGreeting(aiResponse.reply_to_user)) {
        aiResponse = {
          ...aiResponse,
          reply_to_user: "Thanks for your message. I have noted this and will continue from here.",
        };
      }

      const sentId = await sendWhatsAppMessage(
        incomingMessage.from,
        aiResponse.reply_to_user,
        runtimeSettings.phoneId,
        runtimeSettings.whatsappToken
      );

      const outgoingId = sentId || `${incomingMessage.id}:reply`;
      const outgoingMessage: StoredMessage = {
        id: outgoingId,
        from: incomingMessage.from,
        to: incomingMessage.to,
        contact_name: incomingMessage.contact_name,
        is_priority: false,
        priority_reasons: [],
        reply_source: "ai",
        text: aiResponse.reply_to_user,
        timestamp: new Date().toISOString(),
        type: "outgoing",
      };
      upsertStoredMessage(state, outgoingMessage);

      const idx = state.messages.findIndex((m) => m.id === incomingMessage.id);
      if (idx >= 0) {
        upsertStoredMessage(state, {
          ...state.messages[idx],
          ai_response: aiResponse,
        });
      }
      state.messages = pruneMessages(state.messages);
      await saveState(statePath, state);
      console.log(`Auto-replied to message ${incomingMessage.id}`);

      if (aiResponse.lead_score >= runtimeSettings.leadNotifyThreshold) {
        const contact = state.contacts[normalizePhone(incomingMessage.from)];
        void syncToGoogleSheets({
          event: "lead",
          ai_enabled: contact?.ai_enabled ?? true,
          contact_label: contact?.label ?? "",
          contact_name: incomingMessage.contact_name,
          from: incomingMessage.from,
          importance_reason: aiResponse.importance_reason,
          is_priority:
            (incomingMessage.is_priority ?? false) || aiResponse.is_important,
          lead_score: aiResponse.lead_score,
          message_id: incomingMessage.id,
          message_text: incomingMessage.text,
          timestamp: incomingMessage.timestamp,
          to: incomingMessage.to,
        });
      }

      if (
        runtimeSettings.personalPhone &&
        aiResponse.lead_score >= runtimeSettings.leadNotifyThreshold &&
        normalizePhone(runtimeSettings.personalPhone) !== normalizePhone(incomingMessage.from)
      ) {
        try {
          const leadNote =
            `High-intent lead alert (score ${aiResponse.lead_score}/10)\n` +
            `Contact: ${incomingMessage.contact_name || incomingMessage.from}\n` +
            `Message: ${incomingMessage.text}`;
          await sendWhatsAppMessage(
            runtimeSettings.personalPhone,
            leadNote,
            runtimeSettings.phoneId,
            runtimeSettings.whatsappToken
          );
        } catch (notifyError) {
          console.error(`Failed lead notification for message ${incomingMessage.id}`, notifyError);
        }
      }
    } catch (error) {
      console.error(`Failed auto-reply for message ${incomingMessage.id}`, error);
    }
  }
}

function getMessageDateKey(message: StoredMessage, timeZone: string): string {
  const timestampMs = Date.parse(message.timestamp);
  const messageDate = Number.isFinite(timestampMs) ? new Date(timestampMs) : new Date();
  return getDateKey(messageDate, timeZone);
}

function getWeekKey(date: Date): string {
  const firstDay = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((date.getTime() - firstDay.getTime()) / 86400000) + 1;
  const week = Math.ceil(dayOfYear / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function buildAnalytics(state: AppState) {
  const incoming = state.messages.filter((message) => message.type === "incoming");
  const outgoing = state.messages.filter((message) => message.type === "outgoing");
  const aiRepliedCount = incoming.filter((message) => Boolean(message.ai_response)).length;
  const aiResponseRate = incoming.length > 0 ? aiRepliedCount / incoming.length : 0;

  const perDay = new Map<string, number>();
  const perWeek = new Map<string, number>();
  const contactCount = new Map<string, number>();
  const peakHours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));

  for (const message of incoming) {
    const parsedMs = Date.parse(message.timestamp);
    const date = Number.isFinite(parsedMs) ? new Date(parsedMs) : new Date();
    const dayKey = date.toISOString().slice(0, 10);
    perDay.set(dayKey, (perDay.get(dayKey) ?? 0) + 1);

    const weekKey = getWeekKey(date);
    perWeek.set(weekKey, (perWeek.get(weekKey) ?? 0) + 1);

    const contactKey = normalizePhone(message.from);
    contactCount.set(contactKey, (contactCount.get(contactKey) ?? 0) + 1);

    const hour = date.getUTCHours();
    peakHours[hour].count += 1;
  }

  const mostActiveContacts = Array.from(contactCount.entries())
    .map(([phone, count]) => ({
      phone,
      count,
      label: state.contacts[phone]?.label || "",
      name: state.contacts[phone]?.last_contact_name || phone,
      ai_enabled: state.contacts[phone]?.ai_enabled ?? true,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const dailyTotals = Array.from(perDay.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const weeklyTotals = Array.from(perWeek.entries())
    .map(([week, count]) => ({ week, count }))
    .sort((a, b) => (a.week < b.week ? -1 : 1));

  return {
    ai_response_rate: aiResponseRate,
    incoming_total: incoming.length,
    outgoing_total: outgoing.length,
    daily_totals: dailyTotals,
    weekly_totals: weeklyTotals,
    most_active_contacts: mostActiveContacts,
    peak_hours_utc: peakHours,
  };
}

function buildDailySummaryText(
  state: AppState,
  timeZone: string,
  leadThreshold: number
): string {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const yesterdayKey = getDateKey(yesterday, timeZone);
  const yesterdayIncoming = state.messages.filter(
    (message) =>
      message.type === "incoming" && getMessageDateKey(message, timeZone) === yesterdayKey
  );
  const priorityCount = yesterdayIncoming.filter(
    (message) => message.is_priority || message.ai_response?.is_important
  ).length;
  const leadSet = new Set(
    yesterdayIncoming
      .filter((message) => (message.ai_response?.lead_score ?? 0) >= leadThreshold)
      .map((message) => normalizePhone(message.from))
  );

  return `Yesterday: ${yesterdayIncoming.length} messages, ${priorityCount} priority alerts, ${leadSet.size} new leads`;
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
  const ENV_PERSONAL_PHONE = process.env.MY_PERSONAL_PHONE?.trim();
  const ENV_SUMMARY_TIMEZONE = process.env.SUMMARY_TIMEZONE?.trim() || "Asia/Kolkata";
  const ENV_LEAD_NOTIFY_THRESHOLD = Number(process.env.LEAD_NOTIFY_THRESHOLD ?? "8");
  const leadNotifyThreshold =
    Number.isFinite(ENV_LEAD_NOTIFY_THRESHOLD) && ENV_LEAD_NOTIFY_THRESHOLD >= 1
      ? Math.min(Math.floor(ENV_LEAD_NOTIFY_THRESHOLD), 10)
      : 8;
  const ENV_ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim() || "admin";
  const ENV_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim() || "change-me-now";
  const { state, statePath } = await initializeState();

  if (!state.settings.system_prompt && ENV_SYSTEM_PROMPT) {
    state.settings.system_prompt = ENV_SYSTEM_PROMPT;
    await saveState(statePath, state);
  }

  if (ENV_ADMIN_PASSWORD === "change-me-now") {
    console.warn("Using default ADMIN_PASSWORD. Set a strong ADMIN_PASSWORD in environment variables.");
  }
  const priorityKeywords = parsePriorityKeywords();

  setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessionStore.entries()) {
      if (session.expiresAt <= now) {
        sessionStore.delete(token);
      }
    }
    for (const [clientKey, attempts] of loginAttemptStore.entries()) {
      if (attempts.resetAt <= now) {
        loginAttemptStore.delete(clientKey);
      }
    }
  }, 60 * 1000).unref();

  setInterval(() => {
    const now = new Date();
    const { hour, minute } = getHourMinuteInZone(now, ENV_SUMMARY_TIMEZONE);
    if (hour !== DAILY_SUMMARY_TARGET_HOUR || minute !== 0) {
      return;
    }

    const todayKey = getDateKey(now, ENV_SUMMARY_TIMEZONE);
    if (state.meta?.last_daily_summary_date === todayKey) {
      return;
    }

    const phoneId = ENV_PHONE_ID || state.settings.phone_id;
    const whatsappToken = ENV_WHATSAPP_TOKEN || state.settings.whatsapp_token;
    const personalPhone = ENV_PERSONAL_PHONE || state.settings.personal_phone;
    if (!phoneId || !whatsappToken || !personalPhone) {
      return;
    }

    const summaryText = buildDailySummaryText(state, ENV_SUMMARY_TIMEZONE, leadNotifyThreshold);
    void sendWhatsAppMessage(personalPhone, summaryText, phoneId, whatsappToken)
      .then(async () => {
        state.meta = { ...(state.meta ?? {}), last_daily_summary_date: todayKey };
        await saveState(statePath, state);
      })
      .catch((error) => {
        console.error("Failed sending daily summary report", error);
      });
  }, 60 * 1000).unref();

  app.set("trust proxy", 1);
  app.use(express.json({ limit: "2mb" }));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    if ((req.headers["x-forwarded-proto"] || "").toString().includes("https")) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  app.get("/auth/me", (req, res) => {
    const session = getSessionFromRequest(req);
    if (!session) {
      return res.json({ authenticated: false });
    }
    return res.json({ authenticated: true, email: session.email });
  });

  app.post("/auth/login", (req, res) => {
    const clientKey = getClientKey(req);
    const limited = isLoginRateLimited(clientKey);
    if (limited.limited) {
      return res.status(429).json({
        ok: false,
        error: `Too many login attempts. Try again in ${limited.retryAfterSec}s.`,
      });
    }

    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const valid =
      secureEquals(email, ENV_ADMIN_EMAIL) && secureEquals(password, ENV_ADMIN_PASSWORD);

    if (!valid) {
      trackFailedLogin(clientKey);
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    clearFailedLogin(clientKey);
    const sessionToken = createSession(email);
    res.cookie(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: getSessionTtlMs(),
      path: "/",
    });
    return res.json({ ok: true, email });
  });

  app.post("/auth/logout", (req, res) => {
    clearSessionFromRequest(req);
    res.cookie(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      expires: new Date(0),
      path: "/",
    });
    return res.json({ ok: true });
  });

  const requireAuth: express.RequestHandler = (req, res, next) => {
    const session = getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    next();
  };

  app.get("/api/messages", requireAuth, (req, res) => {
    const limitRaw = Number(req.query.limit);
    const count =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 1000) : 200;
    const query = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const phone = typeof req.query.phone === "string" ? normalizePhone(req.query.phone) : "";
    const labelFilter =
      typeof req.query.label === "string" ? req.query.label.trim().toLowerCase() : "";
    const fromRaw = typeof req.query.dateFrom === "string" ? req.query.dateFrom : "";
    const toRaw = typeof req.query.dateTo === "string" ? req.query.dateTo : "";
    const fromMs = Date.parse(fromRaw);
    let toMs = Date.parse(toRaw);
    if (/^\d{4}-\d{2}-\d{2}$/.test(toRaw) && Number.isFinite(toMs)) {
      toMs += 24 * 60 * 60 * 1000 - 1;
    }

    const filtered = state.messages.filter((message) => {
      const messageFrom = normalizePhone(message.from);
      const messageTo = normalizePhone(message.to);
      if (phone && messageFrom !== phone && messageTo !== phone) {
        return false;
      }

      if (labelFilter) {
        const label = state.contacts[messageFrom]?.label?.toLowerCase() ?? "";
        if (label !== labelFilter) {
          return false;
        }
      }

      const messageTimestamp = Date.parse(message.timestamp);
      if (Number.isFinite(fromMs) && (!Number.isFinite(messageTimestamp) || messageTimestamp < fromMs)) {
        return false;
      }
      if (Number.isFinite(toMs) && (!Number.isFinite(messageTimestamp) || messageTimestamp > toMs)) {
        return false;
      }

      if (!query) {
        return true;
      }
      const textHaystack = [
        message.text,
        message.contact_name ?? "",
        message.from,
        message.to,
        message.ai_response?.summary ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return textHaystack.includes(query);
    });

    const sorted = sortMessagesNewestFirst([...filtered]);
    res.json(sorted.slice(0, count));
  });

  app.get("/api/settings", requireAuth, (_req, res) => {
    res.json({ system_prompt: state.settings.system_prompt });
  });

  app.put("/api/settings", requireAuth, async (req, res) => {
    try {
      const payload = req.body ?? {};
      if (typeof payload.system_prompt === "string") {
        state.settings.system_prompt = payload.system_prompt;
      }
      await saveState(statePath, state);
      res.json({ ok: true, settings: { system_prompt: state.settings.system_prompt } });
    } catch (error) {
      console.error("Failed to save settings", error);
      res.status(500).json({ ok: false, error: "Failed to save settings" });
    }
  });

  app.get("/api/contacts", requireAuth, (_req, res) => {
    const byPhone = new Set<string>();
    for (const message of state.messages) {
      byPhone.add(normalizePhone(message.from));
    }
    for (const phone of Object.keys(state.contacts)) {
      byPhone.add(normalizePhone(phone));
    }

    const contacts = Array.from(byPhone.values())
      .filter((phone) => phone.length > 0)
      .map((phone) => {
        const config = getContactConfig(state, phone);
        const related = state.messages.filter((message) => normalizePhone(message.from) === phone);
        const latest = sortMessagesNewestFirst([...related])[0];
        return {
          phone,
          ai_enabled: config.ai_enabled,
          label: config.label,
          name: config.last_contact_name || latest?.contact_name || phone,
          last_timestamp: latest?.timestamp || null,
          message_count: related.length,
        };
      })
      .sort((a, b) => {
        const aMs = a.last_timestamp ? Date.parse(a.last_timestamp) : 0;
        const bMs = b.last_timestamp ? Date.parse(b.last_timestamp) : 0;
        return bMs - aMs;
      });

    res.json(contacts);
  });

  app.patch("/api/contacts/:phone", requireAuth, async (req, res) => {
    try {
      const phone = normalizePhone(req.params.phone || "");
      if (!phone) {
        return res.status(400).json({ ok: false, error: "Phone is required" });
      }
      const payload = req.body ?? {};
      const config = getContactConfig(state, phone);

      if (typeof payload.ai_enabled === "boolean") {
        config.ai_enabled = payload.ai_enabled;
      }
      if (typeof payload.label === "string") {
        config.label = payload.label.trim();
      }
      if (typeof payload.name === "string" && payload.name.trim().length > 0) {
        config.last_contact_name = payload.name.trim();
      }

      state.contacts[phone] = config;
      await saveState(statePath, state);
      return res.json({ ok: true, contact: { phone, ...config } });
    } catch (error) {
      console.error("Failed to update contact config", error);
      return res.status(500).json({ ok: false, error: "Failed to update contact config" });
    }
  });

  app.get("/api/analytics", requireAuth, (_req, res) => {
    res.json(buildAnalytics(state));
  });

  app.post("/api/reply-suggestions", requireAuth, async (req, res) => {
    try {
      const phone = typeof req.body?.to === "string" ? normalizePhone(req.body.to) : "";
      if (!phone) {
        return res.status(400).json({ ok: false, error: "Field 'to' is required." });
      }

      const countRaw = Number(req.body?.count);
      const count =
        Number.isFinite(countRaw) && countRaw > 0 ? Math.min(Math.floor(countRaw), 5) : 3;

      const conversationHistory = state.messages
        .filter((message) => normalizePhone(message.from) === phone)
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
        .slice(-25);

      const suggestions = await generateManualReplySuggestions(
        conversationHistory,
        state.settings.system_prompt || ENV_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT,
        count
      );
      return res.json({ ok: true, suggestions });
    } catch (error) {
      console.error("Failed generating manual reply suggestions", error);
      return res.status(500).json({ ok: false, error: "Failed to generate suggestions" });
    }
  });

  app.post("/api/reply", requireAuth, async (req, res) => {
    try {
      const to = typeof req.body?.to === "string" ? normalizePhone(req.body.to) : "";
      const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
      if (!to || !text) {
        return res.status(400).json({ ok: false, error: "Both 'to' and 'text' are required." });
      }

      const phoneId = ENV_PHONE_ID || state.settings.phone_id;
      const whatsappToken = ENV_WHATSAPP_TOKEN || state.settings.whatsapp_token;
      if (!phoneId || !whatsappToken) {
        return res.status(400).json({
          ok: false,
          error: "WhatsApp credentials are missing in environment variables.",
        });
      }

      const sentId = await sendWhatsAppMessage(to, text, phoneId, whatsappToken);
      const outgoingMessage: StoredMessage = {
        id: sentId || `manual-${to}-${Date.now()}`,
        from: to,
        to: state.settings.phone_id || phoneId,
        contact_name: state.contacts[to]?.last_contact_name,
        is_priority: false,
        priority_reasons: [],
        reply_source: "manual",
        text,
        timestamp: new Date().toISOString(),
        type: "outgoing",
      };
      upsertStoredMessage(state, outgoingMessage);
      state.messages = pruneMessages(state.messages);
      await saveState(statePath, state);

      return res.json({ ok: true, message: outgoingMessage });
    } catch (error) {
      console.error("Failed sending manual reply", error);
      return res.status(500).json({ ok: false, error: "Failed to send reply" });
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
        const contactConfig = getContactConfig(state, message.from, message.contact_name);
        const priorityReasons = detectPriorityReasons(message.text, priorityKeywords);
        const enrichedMessage: StoredMessage = {
          ...message,
          contact_name: message.contact_name || contactConfig.last_contact_name,
          is_priority: priorityReasons.length > 0,
          priority_reasons:
            priorityReasons.length > 0
              ? priorityReasons.map((keyword) => `Keyword match: ${keyword}`)
              : [],
        };

        const existing = state.messages.find((item) => item.id === enrichedMessage.id);
        upsertStoredMessage(state, enrichedMessage);
        if (!existing) {
          newlyStoredIncoming.push(enrichedMessage);
        }
      }
      state.messages = pruneMessages(state.messages);
      await saveState(statePath, state);

      console.log(`Stored ${incomingMessages.length} incoming WhatsApp message(s)`);
      res.sendStatus(200);

      if (newlyStoredIncoming.length > 0) {
        void Promise.all(
          newlyStoredIncoming.map((message) => {
            const contact = state.contacts[normalizePhone(message.from)];
            return syncToGoogleSheets({
              event: "message",
              ai_enabled: contact?.ai_enabled ?? true,
              contact_label: contact?.label ?? "",
              contact_name: message.contact_name,
              from: message.from,
              is_priority: message.is_priority ?? false,
              message_id: message.id,
              message_text: message.text,
              timestamp: message.timestamp,
              to: message.to,
            });
          })
        );

        const phoneId = ENV_PHONE_ID || state.settings.phone_id;
        const whatsappToken = ENV_WHATSAPP_TOKEN || state.settings.whatsapp_token;
        const personalPhone = ENV_PERSONAL_PHONE || state.settings.personal_phone;

        if (phoneId && whatsappToken && personalPhone) {
          const priorityMessages = newlyStoredIncoming.filter(
            (message) => message.is_priority && (message.priority_reasons?.length ?? 0) > 0
          );
          for (const message of priorityMessages) {
            if (normalizePhone(message.from) === normalizePhone(personalPhone)) {
              continue;
            }
            const alertText =
              `Priority keyword alert\n` +
              `Contact: ${message.contact_name || message.from}\n` +
              `Message: ${message.text}\n` +
              `Reason: ${(message.priority_reasons ?? []).join(", ")}`;
            void sendWhatsAppMessage(personalPhone, alertText, phoneId, whatsappToken).catch((error) => {
              console.error("Failed sending priority alert", error);
            });
          }
        }

        const runtimeSettings = {
          whatsappToken: whatsappToken || "",
          phoneId: phoneId || "",
          personalPhone: personalPhone || "",
          leadNotifyThreshold,
          systemPrompt: state.settings.system_prompt || ENV_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT,
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
