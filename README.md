<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/1e337cdb-9b6d-400a-9986-3f6ec76de7b6

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Data Storage

This app now uses local JSON persistence via `DATA_DIR` (default `./data/state.json`) and no Firebase dependencies.

For production reliability on Render, prefer a managed database (Render Postgres) instead of local disk because local files are ephemeral on restarts/deploys.

## Auto Reply Requirements

Set these for automatic AI replies on inbound webhook messages:

1. `WHATSAPP_TOKEN`
2. `PHONE_ID`
3. `GEMINI_API_KEY`
4. Optional: `SYSTEM_PROMPT`, `WHATSAPP_API_VERSION`, `GEMINI_MODEL` (default: `gemini-2.5-flash-lite`)

## Admin Login And Security

Set these to secure dashboard access:

1. `ADMIN_EMAIL`
2. `ADMIN_PASSWORD`
3. Optional: `SESSION_TTL_HOURS`

All `/api/*` dashboard endpoints are now protected by session auth. Webhook endpoints remain public for Meta delivery.

## Google Sheets Sync

To auto-log every new inbound message and qualified leads to Google Sheets:

1. Create a Google Apps Script Web App that accepts `POST` JSON and appends rows.
2. Set:
   1. `GOOGLE_SHEETS_WEBHOOK_URL`
   2. Optional: `GOOGLE_SHEETS_WEBHOOK_SECRET` (validated in Apps Script via `x-sheets-secret` header)

Sync behavior:

1. Every new inbound message sends `event: "message"`.
2. High-score leads send `event: "lead"` after AI scoring.
