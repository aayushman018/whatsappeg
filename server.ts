import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  console.log("--- Simple Server Start ---");
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN?.trim();

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
    // Keep this endpoint alive for Meta webhook event delivery.
    console.log("Webhook event received");
    return res.sendStatus(200);
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
