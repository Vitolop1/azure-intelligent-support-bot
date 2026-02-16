// index.js - Azure Intelligent Support Bot (Web + API)
// Bot Framework + Restify + Azure AI Language
"use strict";

require("dotenv").config();

const restify = require("restify");
const path = require("path");
const { BotFrameworkAdapter } = require("botbuilder");
const { AzureKeyCredential } = require("@azure/core-auth");
const { TextAnalysisClient } = require("@azure/ai-language-text");

// ---------------------------
// Helpers
// ---------------------------
function nowISO() {
  return new Date().toISOString();
}
function safeTrim(s) {
  return (s || "").toString().trim();
}
function lower(s) {
  return safeTrim(s).toLowerCase();
}
function env(name, { required = false, fallback = "" } = {}) {
  const v = process.env[name];
  if (required && (!v || !String(v).trim())) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return (v && String(v).trim()) || fallback;
}
function containsAny(text, words) {
  const t = lower(text);
  return words.some((w) => t.includes(w));
}
function uniqPush(arr, value) {
  if (!value) return;
  if (!arr.includes(value)) arr.push(value);
}

// ---------------------------
// Azure Language Client
// ---------------------------
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

function formatConfidence(sentimentDoc) {
  const cs = sentimentDoc?.confidenceScores;
  if (!cs) return "";
  return ` (pos ${Number(cs.positive).toFixed(2)}, neu ${Number(cs.neutral).toFixed(
    2
  )}, neg ${Number(cs.negative).toFixed(2)})`;
}

function tonePrefix(sentimentDoc) {
  const s = sentimentDoc?.sentiment || "neutral";
  if (s === "negative") return "I got you — we’ll fix this. 💪";
  if (s === "positive") return "Nice — let’s keep that momentum. 😄";
  return "Alright — let’s troubleshoot this step-by-step. ✅";
}

function piiWarning(piiDoc) {
  const entities = piiDoc?.entities || [];
  if (!entities.length) return null;
  const types = [...new Set(entities.map((e) => e.category).filter(Boolean))].slice(0, 6);
  return `⚠️ I might be seeing sensitive info (${types.join(
    ", "
  )}). Please don’t paste passwords/keys/cards/tokens. Redact like: ABCD****WXYZ.`;
}

function classifyIssue(text, keyPhrases = []) {
  const t = lower(text);
  const kp = (keyPhrases || []).map((k) => lower(k));

  if (
    containsAny(t, ["wifi", "wi-fi", "internet", "router", "dns", "ip", "ethernet", "network"]) ||
    kp.some((x) => ["wifi", "router", "dns", "ip", "internet", "network"].includes(x))
  ) return "network";

  if (containsAny(t, ["windows", "blue screen", "bsod", "driver", "update"])) return "windows";
  if (containsAny(t, ["login", "password", "account", "mfa", "2fa", "sign in", "signin"])) return "account";
  if (containsAny(t, ["app", "crash", "error", "bug", "install", "uninstall", "permission"])) return "app";

  return "triage";
}

function flowIntro(mode) {
  const map = {
    triage:
      "Quick triage: tell me (1) what you’re trying to do, (2) what happened instead, (3) exact error text if any.",
    network:
      "Network mode: we’ll check connection + DNS quickly. First: are you on Wi-Fi or Ethernet?",
    windows:
      "Windows mode: we’ll check updates/drivers + basic health. First: Windows 10 or 11? What changed recently?",
    account:
      "Account mode: we’ll isolate login/MFA/lockout. First: Microsoft login, school SSO, or app login?",
    app:
      "App mode: we’ll isolate crashes/errors. First: what app + version, and what’s the exact error?",
  };
  return map[mode] || map.triage;
}

function ticketSummary(ticket) {
  const lines = [];
  lines.push("----- TECH SUPPORT TICKET SUMMARY -----");
  lines.push(`Issue: ${ticket.issue || "(not set)"}`);
  lines.push(`Device: ${ticket.device || "(unknown)"}`);
  lines.push(`OS: ${ticket.os || "(unknown)"}`);
  lines.push(`App: ${ticket.app || "(n/a)"}`);
  lines.push(`Urgency: ${ticket.urgency || "normal"}`);
  if (ticket.symptoms?.length) lines.push(`Symptoms: ${ticket.symptoms.join(" | ")}`);
  if (ticket.errors?.length) lines.push(`Errors: ${ticket.errors.join(" | ")}`);
  if (ticket.whatTried?.length) lines.push(`Tried: ${ticket.whatTried.join(" | ")}`);
  lines.push("--------------------------------------");
  return lines.join("\n");
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
    "Tip: Don’t paste secrets. Redact sensitive text.",
  ].join("\n");
}

function parseModeCommand(text) {
  const t = lower(text);
  if (!t.startsWith("mode ")) return null;
  const m = t.slice(5).trim();
  if (["network", "windows", "account", "app", "triage"].includes(m)) return m;
  return null;
}

// ---------------------------
// Sessions (simple demo)
// ---------------------------
const sessions = new Map();
function getSession(sid) {
  const key = sid || "no-sid";
  if (!sessions.has(key)) {
    sessions.set(key, {
      lastSeenAt: nowISO(),
      mode: "idle",
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
    });
  }
  const s = sessions.get(key);
  s.lastSeenAt = nowISO();
  return s;
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

// ---------------------------
// Restify server
// ---------------------------
const server = restify.createServer();
server.use(restify.plugins.bodyParser());

// Serve the web UI at "/"
server.get(
  "/",
  restify.plugins.serveStatic({
    directory: path.join(__dirname, "public"),
    default: "index.html",
  })
);

// Health endpoint (JSON) at "/health"
server.get("/health", (_req, res, _next) => {
  res.send(200, { ok: true, name: "azure-intelligent-support-bot", time: nowISO() });
});

// ---------------------------
// Bot adapter (kept for Emulator use)
// ---------------------------
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

// Bot Framework endpoint (Emulator)
server.post("/api/messages", async (req, res) => {
  await adapter.processActivity(req, res, async (context) => {
    // Remote Emulator fix: if emulator serviceUrl is localhost, use expectReplies
    try {
      const su = context.activity?.serviceUrl || "";
      if (typeof su === "string" && su.includes("localhost")) {
        context.activity.deliveryMode = "expectReplies";
      }
    } catch (_) {}

    if (context.activity.type !== "message") return;

    const userText = safeTrim(context.activity.text);
    if (!userText) {
      await context.sendActivity("Send a message and I’ll help you troubleshoot.");
      return;
    }

    // Reuse the same brain as webchat
    const payload = { text: userText, sid: context.activity.conversation?.id || "emulator" };
    const out = await handleWebChat(payload);
    for (const line of out.replies) {
      await context.sendActivity(line);
    }
  });
});

// Web chat endpoint (your HTML calls this)
server.post("/webchat", async (req, res) => {
  try {
    const { text, sid } = req.body || {};
    const out = await handleWebChat({ text, sid });
    res.send(200, out);
  } catch (e) {
    console.error("[/webchat] error:", e?.message || e);
    res.send(500, { message: "Server error" });
  }
});

// Core handler (shared by Emulator + Web UI)
async function handleWebChat({ text, sid }) {
  const userText = safeTrim(text);
  const session = getSession(sid);

  if (!userText) return { replies: ["Type something and I’ll help."], sid };

  const t = lower(userText);

  // commands
  if (t === "help") return { replies: [helpText()], sid };
  if (t === "reset") {
    resetSession(session);
    return { replies: ["✅ Reset done. Type 'start' to begin."], sid };
  }
  if (t === "start") {
    session.mode = "triage";
    session.step = 0;
    return { replies: ["✅ Starting tech support flow.", flowIntro(session.mode)], sid };
  }
  if (t === "summary") {
    return { replies: ["Here’s your ticket summary:", "```text\n" + ticketSummary(session.ticket) + "\n```"], sid };
  }
  const forcedMode = parseModeCommand(userText);
  if (forcedMode) {
    session.mode = forcedMode;
    session.step = 0;
    return { replies: [`✅ Mode set to: ${forcedMode}`, flowIntro(session.mode)], sid };
  }

  // language analysis
  let analysis;
  try {
    analysis = await analyzeLanguage(userText);
  } catch (e) {
    return { replies: ["⚠️ Azure Language Service failed (check LANGUAGE_ENDPOINT / LANGUAGE_KEY)."], sid };
  }

  const replies = [];

  const piiMsg = piiWarning(analysis.pii);
  if (piiMsg) replies.push(piiMsg);

  const detectedLang = analysis.language?.primaryLanguage?.iso6391Name || "unknown";
  const sentiment = analysis.sentiment?.sentiment || "neutral";
  const conf = formatConfidence(analysis.sentiment);

  const keyPhrases = analysis.keyphrases?.keyPhrases || [];
  const topKP = keyPhrases.slice(0, 6);

  if (session.mode === "idle") {
    session.mode = classifyIssue(userText, topKP);
    session.step = 0;
    session.ticket.issue = session.ticket.issue || userText.slice(0, 180);
    if (topKP.length) uniqPush(session.ticket.symptoms, "keywords: " + topKP.join(", "));
    replies.push(`${tonePrefix(analysis.sentiment)} (lang: ${detectedLang}, sentiment: ${sentiment}${conf})`);
    replies.push(flowIntro(session.mode));
    return { replies, sid };
  }

  if (topKP.length) uniqPush(session.ticket.symptoms, "keywords: " + topKP.join(", "));

  // minimal flows (kept short)
  if (session.mode === "triage") {
    if (session.step === 0) {
      session.ticket.issue = userText;
      session.step = 1;
      replies.push(`${tonePrefix(analysis.sentiment)} Got it.`);
      replies.push("1) What device are you on? (Windows/Mac/Phone + model if possible)");
      return { replies, sid };
    }
    if (session.step === 1) {
      session.ticket.device = userText;
      session.step = 2;
      replies.push("2) What OS + version? (Windows 11, macOS, iOS, Android, etc.)");
      return { replies, sid };
    }
    if (session.step === 2) {
      session.ticket.os = userText;
      session.step = 3;
      replies.push("3) Paste the exact error text (redacted). If no error, describe what happens.");
      return { replies, sid };
    }
    if (session.step === 3) {
      uniqPush(session.ticket.errors, userText);
      session.mode = classifyIssue((session.ticket.issue || "") + " " + userText, topKP);
      session.step = 0;
      replies.push("Perfect — switching to a focused mode:");
      replies.push(`➡️ Mode: ${session.mode}`);
      replies.push(flowIntro(session.mode));
      return { replies, sid };
    }
  }

  // fallback
  replies.push("Type `start` for guided troubleshooting or `help` for commands.");
  return { replies, sid };
}

// Start
const PORT = process.env.PORT || 3978;
server.listen(PORT, () => {
  console.log(`[${nowISO()}] Server running on http://localhost:${PORT}`);
  console.log(`[${nowISO()}] UI: http://localhost:${PORT}/`);
  console.log(`[${nowISO()}] Health: http://localhost:${PORT}/health`);
  console.log(`[${nowISO()}] Bot endpoint: http://localhost:${PORT}/api/messages`);
});
