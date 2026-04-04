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
