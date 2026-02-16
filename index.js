// index.js - Tech Support Copilot Bot (Azure AI Language + Bot Framework + Restify)
require("dotenv").config();

const restify = require("restify");
const { BotFrameworkAdapter } = require("botbuilder");
const { AzureKeyCredential } = require("@azure/core-auth");
const { TextAnalysisClient } = require("@azure/ai-language-text");

// ---------------------------
// Helpers
// ---------------------------
function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function safeTrim(s) {
  return (s || "").toString().trim();
}

function nowISO() {
  return new Date().toISOString();
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function lower(s) {
  return safeTrim(s).toLowerCase();
}

function containsAny(text, words) {
  const t = lower(text);
  return words.some((w) => t.includes(w));
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

// ---------------------------
// Azure AI Language client
// ---------------------------
const languageClient = new TextAnalysisClient(
  requireEnv("LANGUAGE_ENDPOINT"),
  new AzureKeyCredential(requireEnv("LANGUAGE_KEY"))
);

// Wrapper that tries tasks and returns useful objects
async function analyzeLanguage(userText) {
  const text = safeTrim(userText);
  const docs = [text];

  // NOTE: These task names match the error message you saw:
  // EntityLinking, EntityRecognition, KeyPhraseExtraction, LanguageDetection, PiiEntityRecognition, SentimentAnalysis
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

// ---------------------------
// Simple in-memory session state (good for demo)
// If you deploy, replace with Bot Framework State storage (Cosmos/Blob/etc.)
// ---------------------------
const sessions = new Map(); // key: conversation.id -> state

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

// ---------------------------
// Bot responses (tone)
/// Uses sentiment to adjust tone
// ---------------------------
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

// ---------------------------
// PII guard (super important for “tech help” bot)
// ---------------------------
function piiWarning(piiDoc) {
  // piiDoc.entities contains types like CreditCardNumber, PhoneNumber, Email, etc.
  const entities = piiDoc?.entities || [];
  if (!entities.length) return null;

  // Keep it short + helpful
  const types = [...new Set(entities.map((e) => e.category).filter(Boolean))].slice(0, 6);
  return `⚠️ Heads up: I detected possible sensitive info (${types.join(
    ", "
  )}). Don’t paste passwords/keys/cards. If you need to share something, redact it like: ABCD****WXYZ.`;
}

// ---------------------------
// Tech Support knowledge: quick heuristics
// ---------------------------
function classifyIssue(text, keyPhrases = []) {
  const t = lower(text);
  const kp = keyPhrases.map((k) => lower(k));

  // Quick rules
  if (containsAny(t, ["wifi", "wi-fi", "internet", "router", "dns", "ip", "ethernet"]) ||
      kp.some((x) => ["wifi", "router", "dns", "ip", "internet"].includes(x))) {
    return "network";
  }

  if (containsAny(t, ["windows", "blue screen", "bsod", "driver", "update", "device manager"])) {
    return "windows";
  }

  if (containsAny(t, ["login", "password", "account", "mfa", "2fa", "locked", "sign in"])) {
    return "account";
  }

  if (containsAny(t, ["app", "crash", "error", "bug", "install", "uninstall", "permission"])) {
    return "app";
  }

  return "triage";
}

// ---------------------------
// Flows (guided troubleshooting)
// ---------------------------
function flowIntro(mode) {
  const map = {
    triage:
      "Quick triage: tell me (1) what you’re trying to do, (2) what happened instead, and (3) any exact error text.",
    network:
      "Network mode: we’ll check connection, DNS, and a couple quick commands. First: are you on Wi-Fi or Ethernet?",
    windows:
      "Windows mode: we’ll check updates/drivers + basic health. First: what Windows version (10/11) and what changed recently?",
    account:
      "Account mode: we’ll isolate login/MFA/lockout issues. First: is this Microsoft login, school login, or an app login?",
    app:
      "App mode: we’ll isolate crashes/errors. First: what app + version, and what’s the exact error message?",
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
  lines.push(`Urgency: ${ticket.urgency}`);
  if (ticket.symptoms.length) lines.push(`Symptoms: ${ticket.symptoms.join(" | ")}`);
  if (ticket.errors.length) lines.push(`Errors: ${ticket.errors.join(" | ")}`);
  if (ticket.whatTried.length) lines.push(`Tried: ${ticket.whatTried.join(" | ")}`);
  lines.push("--------------------------------------");
  return lines.join("\n");
}

// ---------------------------
// Command handling
// ---------------------------
function helpText() {
  return [
    "Tech Support Copilot commands:",
    "- help : show commands",
    "- start : begin troubleshooting",
    "- reset : clear session",
    "- summary : generate ticket summary",
    "- mode network | windows | account | app : force a troubleshooting mode",
    "",
    "Tip: Paste ONLY non-sensitive info. Redact secrets like ABCD****WXYZ.",
  ].join("\n");
}

function parseModeCommand(text) {
  const t = lower(text);
  if (t.startsWith("mode ")) {
    const m = t.replace("mode ", "").trim();
    if (["network", "windows", "account", "app", "triage"].includes(m)) return m;
  }
  return null;
}

// ---------------------------
// Restify server
// ---------------------------
const server = restify.createServer();
server.use(restify.plugins.bodyParser());

const port = process.env.PORT || 3978;
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log(`POST endpoint: http://localhost:${port}/api/messages`);
});

// ---------------------------
// Bot Framework Adapter
// For local Emulator: leave BOT_APP_ID/BOT_APP_PASSWORD empty
// ---------------------------
const adapter = new BotFrameworkAdapter({
  appId: process.env.BOT_APP_ID || "",
  appPassword: process.env.BOT_APP_PASSWORD || "",
});

adapter.onTurnError = async (context, err) => {
  console.error("Bot error:", err);
  try {
    await context.sendActivity("Something went wrong on my end. Check the console logs.");
  } catch (_) {}
};

// ---------------------------
// Main endpoint
// ---------------------------
server.post("/api/messages", async (req, res) => {
  await adapter.processActivity(req, res, async (context) => {
    const session = getSession(context);
    const type = context.activity.type;

    if (type !== "message") return;

    const userText = safeTrim(context.activity.text);
    if (!userText) {
      await context.sendActivity("Send a message and I’ll help you troubleshoot.");
      return;
    }

    // Commands first
    const t = lower(userText);
    if (t === "help") {
      await context.sendActivity(helpText());
      return;
    }
    if (t === "reset") {
      resetSession(session);
      await context.sendActivity("Reset done. Type `start` to begin troubleshooting.");
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
      await context.sendActivity(`Mode set to: ${forcedMode}`);
      await context.sendActivity(flowIntro(session.mode));
      return;
    }

    // Azure Language analysis
    let analysis;
    try {
      analysis = await analyzeLanguage(userText);
    } catch (e) {
      console.error("Language analyze fatal error:", e);
      await context.sendActivity("Azure Language call failed. Check endpoint/key and try again.");
      return;
    }

    // PII warning (if any)
    const piiMsg = piiWarning(analysis.pii);
    if (piiMsg) {
      await context.sendActivity(piiMsg);
      // We continue, but remind them to redact
    }

    // Extract signals
    const detectedLang = analysis.language?.primaryLanguage?.iso6391Name || "unknown";
    const sentiment = analysis.sentiment?.sentiment || "neutral";
    const confidence = formatConfidence(analysis.sentiment);

    const keyPhrases = analysis.keyphrases?.keyPhrases || [];
    const topKP = keyPhrases.slice(0, 6);

    // Auto-classify mode if idle
    if (session.mode === "idle") {
      session.mode = classifyIssue(userText, topKP);
      session.step = 0;
      await context.sendActivity(`${tonePrefix(analysis.sentiment)} (lang: ${detectedLang}, sentiment: ${sentiment}${confidence})`);
      await context.sendActivity(flowIntro(session.mode));
      // Also store the initial issue
      session.ticket.issue = session.ticket.issue || userText.slice(0, 140);
      if (topKP.length) session.ticket.symptoms.push("keywords: " + topKP.join(", "));
      return;
    }

    // Store useful stuff in the ticket
    if (topKP.length) {
      // avoid spamming duplicates
      const kwLine = "keywords: " + topKP.join(", ");
      if (!session.ticket.symptoms.includes(kwLine)) session.ticket.symptoms.push(kwLine);
    }

    // Flow logic (guided questions)
    if (session.mode === "triage") {
      // step 0: capture issue
      if (session.step === 0) {
        session.ticket.issue = userText;
        session.step = 1;
        await context.sendActivity(`${tonePrefix(analysis.sentiment)} Got it.`);
        await context.sendActivity("1) What device are you on? (Windows laptop / Mac / phone + model if you can)");
        return;
      }
      // step 1: device
      if (session.step === 1) {
        session.ticket.device = userText;
        session.step = 2;
        await context.sendActivity("2) What OS + version? (ex: Windows 11 / macOS / iOS / Android)");
        return;
      }
      // step 2: os
      if (session.step === 2) {
        session.ticket.os = userText;
        session.step = 3;
        await context.sendActivity("3) Paste the exact error text (redacted). If no error, describe what happens.");
        return;
      }
      // step 3: error text
      if (session.step === 3) {
        session.ticket.errors.push(userText);
        // decide next mode from data
        session.mode = classifyIssue(session.ticket.issue + " " + userText, topKP);
        session.step = 0;
        await context.sendActivity("Perfect. I’m switching you into a focused troubleshooting mode:");
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
        session.ticket.symptoms.push("connection: " + userText);
        session.step = 2;
        await context.sendActivity(
          "Quick checks:\n" +
            "A) Can you open any website?\n" +
            "B) Does it fail on ALL sites or only one?\n" +
            "Reply like: A=yes B=only one"
        );
        return;
      }
      if (session.step === 2) {
        session.ticket.symptoms.push("basic check: " + userText);
        session.step = 3;
        await context.sendActivity(
          "Run ONE of these (Windows):\n" +
            "1) `ipconfig /all`\n" +
            "2) `ping 8.8.8.8 -n 4`\n" +
            "3) `nslookup google.com`\n" +
            "Paste results (redact private IP if you want)."
        );
        return;
      }
      if (session.step === 3) {
        session.ticket.whatTried.push("network diagnostics provided");
        session.ticket.errors.push("network output: " + userText.slice(0, 200));
        session.step = 4;

        // simple heuristic suggestions
        const l = lower(userText);
        if (l.includes("request timed out") || l.includes("unreachable")) {
          await context.sendActivity(
            "This looks like a connectivity path issue.\n" +
              "Try:\n" +
              "- Toggle Wi-Fi off/on\n" +
              "- Reboot router\n" +
              "- Forget network + reconnect\n" +
              "- If on school network, try hotspot to confirm"
          );
        } else if (l.includes("server can't find") || l.includes("dns")) {
          await context.sendActivity(
            "This looks like DNS.\n" +
              "Try:\n" +
              "- `ipconfig /flushdns`\n" +
              "- Set DNS to 1.1.1.1 / 8.8.8.8 (temporarily)\n" +
              "- Restart network adapter"
          );
        } else {
          await context.sendActivity(
            "Thanks. I can work with this output.\n" +
              "Tell me: is this happening only on this device or on multiple devices?"
          );
        }

        await context.sendActivity("Type `summary` anytime to generate a ticket for IT.");
        return;
      }

      await context.sendActivity("If you want, type `summary` or `reset` or `mode triage` to restart.");
      return;
    }

    if (session.mode === "windows") {
      if (session.step === 0) {
        session.ticket.issue = session.ticket.issue || userText;
        session.step = 1;
        await context.sendActivity("What changed right before the problem? (update, new app, driver, new device)");
        return;
      }
      if (session.step === 1) {
        session.ticket.symptoms.push("recent change: " + userText);
        session.step = 2;
        await context.sendActivity(
          "Quick Windows health checks:\n" +
            "1) Open Settings > Windows Update (any pending?)\n" +
            "2) Run `sfc /scannow` (Command Prompt as Admin)\n" +
            "Tell me results or any messages."
        );
        return;
      }
      if (session.step === 2) {
        session.ticket.whatTried.push("windows update/sfc suggested");
        session.ticket.errors.push(userText);
        session.step = 3;

        await context.sendActivity(
          "Next step:\n" +
            "- If it’s an app crashing: reinstall + run as admin\n" +
            "- If it’s BSOD: tell me stop code + recent drivers\n" +
            "- If it’s performance: check Task Manager CPU/RAM/Disk"
        );
        await context.sendActivity("Want me to focus on: `mode app` or stay `mode windows`?");
        return;
      }

      await context.sendActivity("Type `summary` to generate a ticket, or tell me the exact error/stop code.");
      return;
    }

    if (session.mode === "account") {
      if (session.step === 0) {
        session.ticket.issue = session.ticket.issue || userText;
        session.step = 1;
        await context.sendActivity("Is it Microsoft login, school SSO, or app login? (one word is fine)");
        return;
      }
      if (session.step === 1) {
        session.ticket.symptoms.push("login type: " + userText);
        session.step = 2;
        await context.sendActivity(
          "What exactly happens?\n" +
            "- wrong password\n" +
            "- MFA loop\n" +
            "- locked out\n" +
            "- ‘cannot sign in’ error\n" +
            "Paste any error text (redacted)."
        );
        return;
      }
      if (session.step === 2) {
        session.ticket.errors.push(userText);
        session.step = 3;
        await context.sendActivity(
          "Common fixes:\n" +
            "- Try incognito/private window\n" +
            "- Clear cookies for the domain\n" +
            "- Confirm time/date auto-set\n" +
            "- If MFA: re-register authenticator\n" +
            "Which ones did you already try?"
        );
        return;
      }
      if (session.step === 3) {
        session.ticket.whatTried.push(userText);
        await context.sendActivity("Got it. Type `summary` and you’ll have a clean ticket to send to IT/Helpdesk.");
        return;
      }
    }

    if (session.mode === "app") {
      if (session.step === 0) {
        session.ticket.issue = session.ticket.issue || userText;
        session.step = 1;
        await context.sendActivity("What app + version? (example: Chrome 122, VSCode 1.86, etc.)");
        return;
      }
      if (session.step === 1) {
        session.ticket.app = userText;
        session.step = 2;
        await context.sendActivity("What’s the exact error message? (redacted)");
        return;
      }
      if (session.step === 2) {
        session.ticket.errors.push(userText);
        session.step = 3;
        await context.sendActivity(
          "Quick fixes (choose what applies):\n" +
            "A) Restart app + reboot PC\n" +
            "B) Update app\n" +
            "C) Reinstall app\n" +
            "D) Run as admin\n" +
            "E) Check permissions/firewall\n" +
            "Reply with letters: e.g. A,B,D"
        );
        return;
      }
      if (session.step === 3) {
        session.ticket.whatTried.push("app fixes tried: " + userText);
        session.step = 4;
        await context.sendActivity(
          "Nice. If it still fails, we can narrow it down:\n" +
            "- Does it happen for ALL accounts or only yours?\n" +
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
