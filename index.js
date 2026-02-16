// index.js - Azure Intelligent Support Bot (Pro)
// Bot Framework + Restify + Azure AI Language (Sentiment/KeyPhrases/Lang/PII)
//
// Key Fix for remote Emulator:
// If activity.serviceUrl points to localhost (from Emulator) while bot is hosted remotely,
// we force deliveryMode="expectReplies" so responses return in the HTTP response (no callback to localhost).

"use strict";

require("dotenv").config();

const restify = require("restify");
const { BotFrameworkAdapter } = require("botbuilder");
const { AzureKeyCredential } = require("@azure/core-auth");
const { TextAnalysisClient } = require("@azure/ai-language-text");

// ------------------------------------------------------
// Config & Validation
// ------------------------------------------------------
const PORT = process.env.PORT || 3978;

function env(name, { required = false, fallback = "" } = {}) {
  const v = process.env[name];
  if (required && (!v || !String(v).trim())) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return (v && String(v).trim()) || fallback;
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

// ------------------------------------------------------
// Azure Language Client (fail fast, but with clear logs)
// ------------------------------------------------------
const LANGUAGE_ENDPOINT = env("LANGUAGE_ENDPOINT", { required: true });
const LANGUAGE_KEY = env("LANGUAGE_KEY", { required: true });

const languageClient = new TextAnalysisClient(
  LANGUAGE_ENDPOINT,
  new AzureKeyCredential(LANGUAGE_KEY)
);

async function analyzeLanguage(userText) {
  const text = safeTrim(userText);
  const docs = [text];

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
    rawErrors: {
      sentiment: sentimentRes.status === "rejected" ? sentimentRes.reason : null,
      keyphrases: keyphraseRes.status === "rejected" ? keyphraseRes.reason : null,
      language: langRes.status === "rejected" ? langRes.reason : null,
      pii: piiRes.status === "rejected" ? piiRes.reason : null,
    },
  };
}

// ------------------------------------------------------
// In-memory sessions (demo-grade)
// ------------------------------------------------------
const sessions = new Map();
// TTL cleanup (memory safety)
const SESSION_TTL_MS = 45 * 60 * 1000; // 45 minutes
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [cid, s] of sessions.entries()) {
    const last = new Date(s.lastSeenAt).getTime();
    if (!Number.isFinite(last) || last < cutoff) sessions.delete(cid);
  }
}, 5 * 60 * 1000);

function getSession(context) {
  const cid = context.activity?.conversation?.id || "no-conv-id";
  if (!sessions.has(cid)) {
    sessions.set(cid, {
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
    });
  }
  const s = sessions.get(cid);
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

// ------------------------------------------------------
// Tone + Formatting
// ------------------------------------------------------
function tonePrefix(sentimentDoc) {
  const sentiment = sentimentDoc?.sentiment || "neutral";
  if (sentiment === "negative") return "I got you — we’ll fix this. 💪";
  if (sentiment === "positive") return "Nice — let’s keep that momentum. 😄";
  return "Alright — let’s troubleshoot this step-by-step. ✅";
}

function formatConfidence(sentimentDoc) {
  const cs = sentimentDoc?.confidenceScores;
  if (!cs) return "";
  return ` (pos ${Number(cs.positive).toFixed(2)}, neu ${Number(cs.neutral).toFixed(
    2
  )}, neg ${Number(cs.negative).toFixed(2)})`;
}

function piiWarning(piiDoc) {
  const entities = piiDoc?.entities || [];
  if (!entities.length) return null;
  const types = [...new Set(entities.map((e) => e.category).filter(Boolean))].slice(0, 6);
  return `⚠️ I might be seeing sensitive info (${types.join(
    ", "
  )}). Please don’t paste passwords, keys, full emails, card numbers, or tokens. Redact like: ABCD****WXYZ.`;
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

// ------------------------------------------------------
// Issue Classification + Flows
// ------------------------------------------------------
function classifyIssue(text, keyPhrases = []) {
  const t = lower(text);
  const kp = keyPhrases.map((k) => lower(k));

  if (
    containsAny(t, ["wifi", "wi-fi", "internet", "router", "dns", "ip", "ethernet", "network"]) ||
    kp.some((x) => ["wifi", "router", "dns", "ip", "internet", "network"].includes(x))
  ) {
    return "network";
  }

  if (containsAny(t, ["windows", "blue screen", "bsod", "driver", "update", "device manager"])) {
    return "windows";
  }

  if (containsAny(t, ["login", "password", "account", "mfa", "2fa", "locked", "sign in", "signin"])) {
    return "account";
  }

  if (containsAny(t, ["app", "crash", "error", "bug", "install", "uninstall", "permission"])) {
    return "app";
  }

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

// ------------------------------------------------------
// Commands
// ------------------------------------------------------
function helpText() {
  return [
    "Tech Support Copilot commands:",
    "- help : show commands",
    "- start : begin guided troubleshooting",
    "- reset : clear current session",
    "- summary : generate a clean IT ticket",
    "- mode network | windows | account | app | triage : force a mode",
    "",
    "Tip: Paste ONLY non-sensitive info. Redact secrets like ABCD****WXYZ.",
  ].join("\n");
}

function parseModeCommand(text) {
  const t = lower(text);
  if (!t.startsWith("mode ")) return null;
  const m = t.slice(5).trim();
  if (["network", "windows", "account", "app", "triage"].includes(m)) return m;
  return null;
}

// ------------------------------------------------------
// Restify Server
// ------------------------------------------------------
const server = restify.createServer();
server.use(restify.plugins.bodyParser());

// Health endpoint (Render)
server.get("/", (_req, res, _next) => {
  res.send(200, {
    ok: true,
    name: "azure-intelligent-support-bot",
    time: nowISO(),
  });
});

// Bot messages endpoint
server.post("/api/messages", async (req, res) => {
  await adapter.processActivity(req, res, async (context) => {
    // Key Fix: remote bot + Emulator serviceUrl=localhost => force expectReplies
    try {
      const su = context.activity?.serviceUrl || "";
      if (typeof su === "string" && su.includes("localhost")) {
        context.activity.deliveryMode = "expectReplies";
      }
    } catch (_) {}

    const session = getSession(context);

    if (context.activity.type !== "message") return;

    const userText = safeTrim(context.activity.text);
    if (!userText) {
      await context.sendActivity("Send a message and I’ll help you troubleshoot.");
      return;
    }

    // ---- Commands first
    const t = lower(userText);

    if (t === "help") {
      await context.sendActivity(helpText());
      return;
    }

    if (t === "reset") {
      resetSession(session);
      await context.sendActivity("✅ Reset done. Type `start` to begin.");
      return;
    }

    if (t === "start") {
      session.mode = "triage";
      session.step = 0;
      await context.sendActivity("✅ Starting tech support flow.");
      await context.sendActivity(flowIntro(session.mode));
      return;
    }

    if (t === "summary") {
      await context.sendActivity("Here’s your ticket summary:");
      await context.sendActivity("```text\n" + ticketSummary(session.ticket) + "\n```");
      return;
    }

    const forcedMode = parseModeCommand(userText);
    if (forcedMode) {
      session.mode = forcedMode;
      session.step = 0;
      await context.sendActivity(`✅ Mode set to: ${forcedMode}`);
      await context.sendActivity(flowIntro(session.mode));
      return;
    }

    // ---- Azure Language analysis
    let analysis;
    try {
      analysis = await analyzeLanguage(userText);
    } catch (e) {
      console.error("[AzureLanguage] Fatal error:", e?.message || e);
      await context.sendActivity(
        "⚠️ I couldn’t reach Azure Language Service. Double-check LANGUAGE_ENDPOINT and LANGUAGE_KEY."
      );
      return;
    }

    // ---- PII warning
    const piiMsg = piiWarning(analysis.pii);
    if (piiMsg) await context.sendActivity(piiMsg);

    const detectedLang = analysis.language?.primaryLanguage?.iso6391Name || "unknown";
    const sentiment = analysis.sentiment?.sentiment || "neutral";
    const confidence = formatConfidence(analysis.sentiment);

    const keyPhrases = analysis.keyphrases?.keyPhrases || [];
    const topKP = keyPhrases.slice(0, 6);

    // ---- First message in idle => auto-route
    if (session.mode === "idle") {
      session.mode = classifyIssue(userText, topKP);
      session.step = 0;

      // store initial issue
      session.ticket.issue = session.ticket.issue || userText.slice(0, 180);
      if (topKP.length) uniqPush(session.ticket.symptoms, "keywords: " + topKP.join(", "));

      await context.sendActivity(
        `${tonePrefix(analysis.sentiment)} (lang: ${detectedLang}, sentiment: ${sentiment}${confidence})`
      );
      await context.sendActivity(flowIntro(session.mode));
      return;
    }

    // ---- store keywords sometimes (no spam)
    if (topKP.length) uniqPush(session.ticket.symptoms, "keywords: " + topKP.join(", "));

    // ------------------------------------------------------
    // Guided Flows
    // ------------------------------------------------------
    if (session.mode === "triage") {
      if (session.step === 0) {
        session.ticket.issue = userText;
        session.step = 1;
        await context.sendActivity(`${tonePrefix(analysis.sentiment)} Got it.`);
        await context.sendActivity("1) What device are you on? (Windows laptop / Mac / phone + model if possible)");
        return;
      }
      if (session.step === 1) {
        session.ticket.device = userText;
        session.step = 2;
        await context.sendActivity("2) What OS + version? (ex: Windows 11 / macOS / iOS / Android)");
        return;
      }
      if (session.step === 2) {
        session.ticket.os = userText;
        session.step = 3;
        await context.sendActivity("3) Paste the exact error text (redacted). If no error, describe what happens.");
        return;
      }
      if (session.step === 3) {
        uniqPush(session.ticket.errors, userText);
        session.mode = classifyIssue((session.ticket.issue || "") + " " + userText, topKP);
        session.step = 0;
        await context.sendActivity("Perfect — switching to a focused mode:");
        await context.sendActivity(`➡️ Mode: ${session.mode}`);
        await context.sendActivity(flowIntro(session.mode));
        return;
      }
    }

    if (session.mode === "network") {
      if (session.step === 0) {
        session.ticket.issue = session.ticket.issue || userText;
        session.step = 1;
        await context.sendActivity("Are you on Wi-Fi or Ethernet?");
        return;
      }
      if (session.step === 1) {
        uniqPush(session.ticket.symptoms, "connection: " + userText);
        session.step = 2;
        await context.sendActivity(
          "Quick checks:\n" +
            "A) Can you open any website?\n" +
            "B) Does it fail on ALL sites or only one?\n" +
            "Reply like: A=yes B=all"
        );
        return;
      }
      if (session.step === 2) {
        uniqPush(session.ticket.symptoms, "basic check: " + userText);
        session.step = 3;
        await context.sendActivity(
          "Run ONE command (Windows) and paste output (redact if you want):\n" +
            "1) ipconfig /all\n" +
            "2) ping 8.8.8.8 -n 4\n" +
            "3) nslookup google.com"
        );
        return;
      }
      if (session.step === 3) {
        uniqPush(session.ticket.whatTried, "network diagnostics provided");
        uniqPush(session.ticket.errors, "network output: " + userText.slice(0, 220));
        session.step = 4;

        const l = lower(userText);
        if (l.includes("request timed out") || l.includes("unreachable")) {
          await context.sendActivity(
            "That looks like a connectivity path issue.\n" +
              "Try:\n" +
              "- Toggle Wi-Fi off/on\n" +
              "- Reboot router\n" +
              "- Forget network + reconnect\n" +
              "- Test a phone hotspot (to isolate the network)"
          );
        } else if (l.includes("server can't find") || l.includes("dns") || l.includes("non-existent domain")) {
          await context.sendActivity(
            "That looks like DNS.\n" +
              "Try:\n" +
              "- ipconfig /flushdns\n" +
              "- Temporarily set DNS to 1.1.1.1 or 8.8.8.8\n" +
              "- Restart your network adapter"
          );
        } else {
          await context.sendActivity(
            "Thanks — I can work with that.\n" +
              "Next: does it happen only on this device, or multiple devices on the same network?"
          );
        }

        await context.sendActivity("Type `summary` anytime to generate a clean ticket for IT.");
        return;
      }

      await context.sendActivity("If you want, type `summary`, `reset`, or `mode triage` to restart.");
      return;
    }

    if (session.mode === "windows") {
      if (session.step === 0) {
        session.ticket.issue = session.ticket.issue || userText;
        session.step = 1;
        await context.sendActivity("What changed right before the issue? (update, new app, driver, new device)");
        return;
      }
      if (session.step === 1) {
        uniqPush(session.ticket.symptoms, "recent change: " + userText);
        session.step = 2;
        await context.sendActivity(
          "Quick Windows checks:\n" +
            "1) Settings → Windows Update (any pending?)\n" +
            "2) Run: sfc /scannow (Command Prompt as Admin)\n" +
            "Tell me the result messages."
        );
        return;
      }
      if (session.step === 2) {
        uniqPush(session.ticket.whatTried, "windows update/sfc suggested");
        uniqPush(session.ticket.errors, userText);
        session.step = 3;

        await context.sendActivity(
          "Next step options:\n" +
            "- If it’s an app crash: update/reinstall + run as admin\n" +
            "- If it’s BSOD: tell me the stop code + recent drivers\n" +
            "- If it’s slow: Task Manager (CPU/RAM/Disk) screenshot details"
        );
        await context.sendActivity("Want me to focus on `mode app` or stay on `mode windows`?");
        return;
      }

      await context.sendActivity("Type `summary` to generate a ticket, or send the exact stop code/error.");
      return;
    }

    if (session.mode === "account") {
      if (session.step === 0) {
        session.ticket.issue = session.ticket.issue || userText;
        session.step = 1;
        await context.sendActivity("Is it Microsoft login, school SSO, or app login?");
        return;
      }
      if (session.step === 1) {
        uniqPush(session.ticket.symptoms, "login type: " + userText);
        session.step = 2;
        await context.sendActivity(
          "What exactly happens?\n" +
            "- wrong password\n" +
            "- MFA loop\n" +
            "- locked out\n" +
            "- cannot sign in error\n" +
            "Paste any error text (redacted)."
        );
        return;
      }
      if (session.step === 2) {
        uniqPush(session.ticket.errors, userText);
        session.step = 3;
        await context.sendActivity(
          "Common fixes:\n" +
            "- Incognito/private window\n" +
            "- Clear cookies for the domain\n" +
            "- Confirm time/date auto-set\n" +
            "- If MFA: re-register authenticator\n" +
            "Which did you already try?"
        );
        return;
      }
      if (session.step === 3) {
        uniqPush(session.ticket.whatTried, userText);
        await context.sendActivity("Got it. Type `summary` and you’ll have a clean ticket for IT/Helpdesk.");
        return;
      }
    }

    if (session.mode === "app") {
      if (session.step === 0) {
        session.ticket.issue = session.ticket.issue || userText;
        session.step = 1;
        await context.sendActivity("What app + version? (example: Chrome 122, VSCode 1.86)");
        return;
      }
      if (session.step === 1) {
        session.ticket.app = userText;
        session.step = 2;
        await context.sendActivity("What’s the exact error message? (redacted)");
        return;
      }
      if (session.step === 2) {
        uniqPush(session.ticket.errors, userText);
        session.step = 3;
        await context.sendActivity(
          "Quick fixes (reply with letters):\n" +
            "A) Restart app + reboot PC\n" +
            "B) Update app\n" +
            "C) Reinstall app\n" +
            "D) Run as admin\n" +
            "E) Check permissions/firewall\n" +
            "Example: A,B,D"
        );
        return;
      }
      if (session.step === 3) {
        uniqPush(session.ticket.whatTried, "app fixes tried: " + userText);
        session.step = 4;
        await context.sendActivity(
          "Nice. If it still fails, we narrow it down:\n" +
            "- Only your account or all accounts?\n" +
            "- Does it happen on another device?\n" +
            "- Any logs? (Event Viewer / app logs)"
        );
        await context.sendActivity("Type `summary` when you want the final ticket.");
        return;
      }

      await context.sendActivity("Type `summary` or paste the latest result after trying those fixes.");
      return;
    }

    // Fallback
    await context.sendActivity("I’m here. Type `start` to begin a guided flow or `help` for commands.");
  });
});

// ------------------------------------------------------
// Bot Adapter
// ------------------------------------------------------
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

// ------------------------------------------------------
// Start server
// ------------------------------------------------------
server.listen(PORT, () => {
  console.log(`[${nowISO()}] Server running on http://localhost:${PORT}`);
  console.log(`[${nowISO()}] POST endpoint: http://localhost:${PORT}/api/messages`);
});
