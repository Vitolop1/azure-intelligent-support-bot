// index.js - Azure Intelligent Support Bot (Web + Emulator)
// Serves:
//   GET  /            -> public/index.html (web chat UI)
//   GET  /health      -> JSON health check
//   POST /api/analyze -> web chat endpoint (browser)
//   POST /api/messages-> Bot Framework endpoint (Emulator)

"use strict";

require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const restify = require("restify");
const { BotFrameworkAdapter } = require("botbuilder");
const { AzureKeyCredential } = require("@azure/core-auth");
const { TextAnalysisClient } = require("@azure/ai-language-text");

// -------------------- Helpers --------------------
const PORT = process.env.PORT || 3978;

function env(name, { required = false, fallback = "" } = {}) {
  const v = process.env[name];
  const out = (v && String(v).trim()) || fallback;
  if (required && !out) throw new Error(`Missing required environment variable: ${name}`);
  return out;
}

function nowISO() {
  return new Date().toISOString();
}

function safeTrim(s) {
  return (s || "").toString().trim();
}

function lower(s) {
  return safeTrim(s).toLowerCase();
}

function containsAny(text, words) {
  const t = lower(text);
  return words.some((w) => t.includes(w));
}

function uniqPush(arr, value) {
  if (!value) return;
  if (!arr.includes(value)) arr.push(value);
}

function newId() {
  return crypto.randomBytes(16).toString("hex");
}

// -------------------- Azure AI Language --------------------
const LANGUAGE_ENDPOINT = env("LANGUAGE_ENDPOINT", { required: true });
const LANGUAGE_KEY = env("LANGUAGE_KEY", { required: true });

const languageClient = new TextAnalysisClient(
  LANGUAGE_ENDPOINT,
  new AzureKeyCredential(LANGUAGE_KEY)
);

async function analyzeLanguage(userText) {
  const docs = [safeTrim(userText)];

  const [sentimentRes, keyphraseRes, langRes, piiRes] = await Promise.allSettled([
    languageClient.analyze("SentimentAnalysis", docs),
    languageClient.analyze("KeyPhraseExtraction", docs),
    languageClient.analyze("LanguageDetection", docs),
    languageClient.analyze("PiiEntityRecognition", docs),
  ]);

  const pick = (res) => (res.status === "fulfilled" ? res.value?.[0] : null);

  return {
    sentiment: pick(sentimentRes),
    keyphrases: pick(keyphraseRes),
    language: pick(langRes),
    pii: pick(piiRes),
  };
}

// -------------------- Sessions (web + bot) --------------------
const sessions = new Map();
const SESSION_TTL_MS = 45 * 60 * 1000;

setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [sid, s] of sessions.entries()) {
    const last = new Date(s.lastSeenAt).getTime();
    if (!Number.isFinite(last) || last < cutoff) sessions.delete(sid);
  }
}, 5 * 60 * 1000);

function defaultSession() {
  return {
    createdAt: nowISO(),
    lastSeenAt: nowISO(),
    mode: "idle", // idle | triage | network | windows | account | app
    step: 0,
    ticket: {
      issue: "",
      device: "",
      os: "",
      app: "",
      symptoms: [],
      whatTried: [],
      errors: [],
      urgency: "normal",
    },
  };
}

function getSessionById(sessionId) {
  const sid = sessionId || newId();
  if (!sessions.has(sid)) sessions.set(sid, defaultSession());
  const s = sessions.get(sid);
  s.lastSeenAt = nowISO();
  return { sid, s };
}

function resetSession(session) {
  session.mode = "idle";
  session.step = 0;
  session.ticket = {
    issue: "",
    device: "",
    os: "",
    app: "",
    symptoms: [],
    whatTried: [],
    errors: [],
    urgency: "normal",
  };
}

// -------------------- Reply formatting --------------------
function tonePrefix(sentimentDoc) {
  const sentiment = sentimentDoc?.sentiment || "neutral";
  if (sentiment === "negative") return "Got you. We’ll fix this. 💪";
  if (sentiment === "positive") return "Nice — let’s keep it going. 😄";
  return "Alright — let’s troubleshoot step-by-step. ✅";
}

function piiWarning(piiDoc) {
  const entities = piiDoc?.entities || [];
  if (!entities.length) return null;
  const types = [...new Set(entities.map((e) => e.category).filter(Boolean))].slice(0, 6);
  return `⚠️ Quick heads-up: I might be seeing sensitive info (${types.join(
    ", "
  )}). Don’t paste passwords/keys/cards/tokens. Redact like: ABCD****WXYZ.`;
}

function ticketSummary(ticket) {
  const lines = [];
  lines.push("----- TECH SUPPORT TICKET SUMMARY -----");
  lines.push(`Issue: ${ticket.issue || "(not set)"}`);
  lines.push(`Device: ${ticket.device || "(unknown)"}`);
  lines.push(`OS: ${ticket.os || "(unknown)"}`);
  lines.push(`App: ${ticket.app || "(n/a)"}`);
  lines.push(`Urgency: ${ticket.urgency}`);
  if (ticket.symptoms.length) lines.push(`Symptoms: ${ticket.symptoms.join(" | ")}`);
  if (ticket.errors.length) lines.push(`Errors: ${ticket.errors.join(" | ")}`);
  if (ticket.whatTried.length) lines.push(`Tried: ${ticket.whatTried.join(" | ")}`);
  lines.push("--------------------------------------");
  return lines.join("\n");
}

function classifyIssue(text, keyPhrases = []) {
  const t = lower(text);
  const kp = keyPhrases.map((k) => lower(k));

  if (
    containsAny(t, ["wifi", "wi-fi", "internet", "router", "dns", "ip", "ethernet", "network"]) ||
    kp.some((x) => ["wifi", "router", "dns", "ip", "internet", "network"].includes(x))
  ) return "network";

  if (containsAny(t, ["windows", "blue screen", "bsod", "driver", "update", "device manager"]))
    return "windows";

  if (containsAny(t, ["login", "password", "account", "mfa", "2fa", "locked", "sign in", "signin"]))
    return "account";

  if (containsAny(t, ["app", "crash", "error", "bug", "install", "uninstall", "permission"]))
    return "app";

  return "triage";
}

function flowIntro(mode) {
  const map = {
    triage:
      "Tell me this (short is fine):\n1) What you’re trying to do\n2) What happens instead\n3) Exact error text (if any)",
    network: "Network mode:\n1) Wi-Fi or Ethernet?\n2) Does ANY website open?\n3) Any error message?",
    windows: "Windows mode:\n1) Windows 10 or 11?\n2) What changed recently?\n3) Any error/stop code?",
    account: "Account mode:\n1) Microsoft login / School SSO / App login?\n2) What exactly happens?\n3) Error text (redacted)?",
    app: "App mode:\n1) App name + version\n2) Exact error message\n3) What you already tried",
  };
  return map[mode] || map.triage;
}

function helpText() {
  return [
    "Commands:",
    "- help",
    "- start",
    "- reset",
    "- summary",
    "- mode network | windows | account | app | triage",
    "",
    "Tip: Don’t paste sensitive info. Redact secrets like ABCD****WXYZ.",
  ].join("\n");
}

function parseModeCommand(text) {
  const t = lower(text);
  if (!t.startsWith("mode ")) return null;
  const m = t.slice(5).trim();
  if (["network", "windows", "account", "app", "triage"].includes(m)) return m;
  return null;
}

// Core: reply engine for BOTH web and bot
async function handleText(session, userText) {
  const t = lower(userText);

  // Commands
  if (t === "help") return { reply: helpText() };

  if (t === "reset") {
    resetSession(session);
    return { reply: "✅ Reset done. Type `start` to begin." };
  }

  if (t === "start") {
    session.mode = "triage";
    session.step = 0;
    return { reply: "✅ Starting tech support.\n\n" + flowIntro(session.mode) };
  }

  if (t === "summary") {
    return { reply: "```text\n" + ticketSummary(session.ticket) + "\n```" };
  }

  const forcedMode = parseModeCommand(userText);
  if (forcedMode) {
    session.mode = forcedMode;
    session.step = 0;
    return { reply: `✅ Mode set to: ${forcedMode}\n\n` + flowIntro(session.mode) };
  }

  // Azure analysis
  const analysis = await analyzeLanguage(userText);
  const piiMsg = piiWarning(analysis.pii);

  const keyPhrases = analysis.keyphrases?.keyPhrases || [];
  const topKP = keyPhrases.slice(0, 6);

  // First message routes mode
  if (session.mode === "idle") {
    session.mode = classifyIssue(userText, topKP);
    session.step = 0;

    session.ticket.issue = session.ticket.issue || userText.slice(0, 180);
    if (topKP.length) uniqPush(session.ticket.symptoms, "keywords: " + topKP.join(", "));

    const intro = `${tonePrefix(analysis.sentiment)}\n\n${flowIntro(session.mode)}`;
    return { reply: (piiMsg ? piiMsg + "\n\n" : "") + intro };
  }

  // Store keywords lightly
  if (topKP.length) uniqPush(session.ticket.symptoms, "keywords: " + topKP.join(", "));

  // Guided triage with clear numbering
  if (session.mode === "triage") {
    if (session.step === 0) {
      session.ticket.issue = userText;
      session.step = 1;
      return { reply: `${tonePrefix(analysis.sentiment)}\n\n1) What device? (Windows/Mac/phone + model)` };
    }
    if (session.step === 1) {
      session.ticket.device = userText;
      session.step = 2;
      return { reply: "2) What OS + version? (Windows 11 / macOS / iOS / Android)" };
    }
    if (session.step === 2) {
      session.ticket.os = userText;
      session.step = 3;
      return { reply: "3) Paste the exact error text (redacted). If none, describe what happens." };
    }
    if (session.step === 3) {
      uniqPush(session.ticket.errors, userText);
      session.mode = classifyIssue((session.ticket.issue || "") + " " + userText, topKP);
      session.step = 0;
      return { reply: `✅ Got it. Switching to: ${session.mode}\n\n${flowIntro(session.mode)}` };
    }
  }

  if (session.mode === "network") {
    if (session.step === 0) {
      session.step = 1;
      return { reply: "1) Are you on Wi-Fi or Ethernet?" };
    }
    if (session.step === 1) {
      uniqPush(session.ticket.symptoms, "connection: " + userText);
      session.step = 2;
      return { reply: "2) Can you open ANY website? (yes/no)\n3) Does it fail on ALL sites or only one?" };
    }
    if (session.step === 2) {
      uniqPush(session.ticket.symptoms, "basic check: " + userText);
      session.step = 3;
      return {
        reply:
          "Run ONE command (Windows) and paste output:\n" +
          "1) ipconfig /all\n" +
          "2) ping 8.8.8.8 -n 4\n" +
          "3) nslookup google.com",
      };
    }
    if (session.step === 3) {
      uniqPush(session.ticket.whatTried, "network diagnostics provided");
      uniqPush(session.ticket.errors, "network output: " + userText.slice(0, 220));
      session.step = 4;
      return {
        reply:
          "Thanks.\n\n1) Only this device, or multiple devices on the same network?\n2) If you can, test a phone hotspot to isolate the network.\n\nType `summary` anytime.",
      };
    }
  }

  if (session.mode === "windows") {
    return {
      reply:
        "Windows mode — answer these:\n" +
        "1) Windows 10 or 11?\n" +
        "2) What changed recently?\n" +
        "3) Any exact error/stop code?\n\nType `summary` anytime.",
    };
  }

  if (session.mode === "account") {
    return {
      reply:
        "Account mode — answer these:\n" +
        "1) Microsoft login / School SSO / App login?\n" +
        "2) What exactly happens?\n" +
        "3) Error text (redacted)?\n\nType `summary` anytime.",
    };
  }

  if (session.mode === "app") {
    return {
      reply:
        "App mode — answer these:\n" +
        "1) App name + version\n" +
        "2) Exact error message (redacted)\n" +
        "3) What you already tried\n\nType `summary` anytime.",
    };
  }

  return { reply: "I’m here. Type `start` to begin, or `help` for commands." };
}

// -------------------- Restify Server --------------------
const server = restify.createServer();
server.use(restify.plugins.bodyParser());

// CORS (ok for browser)
server.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.send(204);
  return next();
});

// Serve web UI (IMPORTANT: this must be BEFORE any other GET "/" that returns JSON)
server.get(
  "/",
  restify.plugins.serveStatic({
    directory: path.join(__dirname, "public"),
    default: "index.html",
  })
);

// Health
server.get("/health", (req, res, next) => {
  res.send(200, { ok: true, name: "azure-intelligent-support-bot", time: nowISO() });
  return next();
});

// Web chat API (Browser)
server.post("/api/analyze", async (req, res) => {
  try {
    const text = safeTrim(req.body?.text);
    const sessionId = safeTrim(req.body?.sessionId);

    if (!text) return res.send(400, { error: "Missing text" });

    const { sid, s } = getSessionById(sessionId || null);
    const out = await handleText(s, text);

    return res.send(200, {
      ok: true,
      sessionId: sid,
      reply: out.reply,
    });
  } catch (e) {
    console.error("[/api/analyze]", e);
    return res.send(500, { error: e?.message || "Server error" });
  }
});

// -------------------- Bot Framework Adapter --------------------
const adapter = new BotFrameworkAdapter({
  appId: env("BOT_APP_ID", { fallback: "" }),
  appPassword: env("BOT_APP_PASSWORD", { fallback: "" }),
});

adapter.onTurnError = async (context, err) => {
  console.error("[BotError]", err);
  try {
    await context.sendActivity("⚠️ Something went wrong on my end. Check server logs.");
  } catch (_) {}
};

// Emulator / Channels endpoint
server.post("/api/messages", async (req, res) => {
  await adapter.processActivity(req, res, async (context) => {
    // Remote bot + Emulator serviceUrl=localhost fix
    try {
      const su = context.activity?.serviceUrl || "";
      if (typeof su === "string" && su.includes("localhost")) {
        context.activity.deliveryMode = "expectReplies";
      }
    } catch (_) {}

    if (context.activity.type !== "message") return;

    const userText = safeTrim(context.activity.text);
    if (!userText) return context.sendActivity("Send a message and I’ll help you troubleshoot.");

    const cid = context.activity?.conversation?.id || newId();
    const { s } = getSessionById(cid);

    const out = await handleText(s, userText);
    await context.sendActivity(out.reply);
  });
});

// Start
server.listen(PORT, () => {
  console.log(`[${nowISO()}] Server running on http://localhost:${PORT}`);
  console.log(`[${nowISO()}] Web:    http://localhost:${PORT}/`);
  console.log(`[${nowISO()}] Health:  http://localhost:${PORT}/health`);
  console.log(`[${nowISO()}] Analyze: http://localhost:${PORT}/api/analyze`);
  console.log(`[${nowISO()}] Bot:    http://localhost:${PORT}/api/messages`);
});
