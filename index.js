// index.js - Azure Intelligent Support Bot (Bot Framework + Restify + Azure AI Language)
"use strict";

require("dotenv").config();

const restify = require("restify");
const { BotFrameworkAdapter } = require("botbuilder");
const { AzureKeyCredential } = require("@azure/core-auth");
const { TextAnalysisClient } = require("@azure/ai-language-text");

// ===========================
// Config
// ===========================
const CONFIG = {
  port: Number(process.env.PORT || 3978),
  // If you ever want to override emulator serviceUrl (advanced):
  // Set EMULATOR_TUNNEL_SERVICE_URL to your devtunnel URL (rarely needed if Emulator is configured correctly)
  emulatorTunnelServiceUrl: (process.env.EMULATOR_TUNNEL_SERVICE_URL || "").trim(),
  sessionTtlMs: 60 * 60 * 1000, // 1 hour idle cleanup
  maxTextLen: 2000, // keep prompts bounded
};

function env(name, { required = false, fallback = "" } = {}) {
  const v = (process.env[name] || "").trim();
  if (required && !v) throw new Error(`Missing required env var: ${name}`);
  return v || fallback;
}

function nowISO() {
  return new Date().toISOString();
}

function safeTrim(s) {
  return (s ?? "").toString().trim();
}

function lower(s) {
  return safeTrim(s).toLowerCase();
}

function containsAny(text, words) {
  const t = lower(text);
  return words.some((w) => t.includes(w));
}

function uniqPush(arr, val) {
  if (!val) return;
  if (!arr.includes(val)) arr.push(val);
}

function truncate(s, n) {
  const t = safeTrim(s);
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function isLocalhostServiceUrl(serviceUrl) {
  const u = lower(serviceUrl || "");
  return u.includes("localhost") || u.includes("127.0.0.1");
}

// ===========================
// Azure AI Language Client
// ===========================
const languageClient = new TextAnalysisClient(
  env("LANGUAGE_ENDPOINT", { required: true }),
  new AzureKeyCredential(env("LANGUAGE_KEY", { required: true }))
);

async function analyzeLanguage(userText) {
  const text = truncate(userText, CONFIG.maxTextLen);
  const docs = [text];

  // Supported tasks for @azure/ai-language-text v1.1.0:
  // EntityLinking, EntityRecognition, KeyPhraseExtraction, LanguageDetection, PiiEntityRecognition, SentimentAnalysis
  const [sentimentRes, keyphraseRes, langRes, piiRes] = await Promise.allSettled([
    languageClient.analyze("SentimentAnalysis", docs),
    languageClient.analyze("KeyPhraseExtraction", docs),
    languageClient.analyze("LanguageDetection", docs),
    languageClient.analyze("PiiEntityRecognition", docs),
  ]);

  const pickDoc = (res) => (res.status === "fulfilled" ? res.value?.[0] : null);

  return {
    sentiment: pickDoc(sentimentRes),
    keyphrases: pickDoc(keyphraseRes),
    language: pickDoc(langRes),
    pii: pickDoc(piiRes),
    errors: {
      sentiment: sentimentRes.status === "rejected" ? sentimentRes.reason : null,
      keyphrases: keyphraseRes.status === "rejected" ? keyphraseRes.reason : null,
      language: langRes.status === "rejected" ? langRes.reason : null,
      pii: piiRes.status === "rejected" ? piiRes.reason : null,
    },
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
  return `⚠️ Heads up: I detected possible sensitive info (${types.join(
    ", "
  )}). Don’t paste passwords/keys/cards. Redact like: ABCD****WXYZ.`;
}

// ===========================
// Session State (in-memory demo)
// ===========================
const sessions = new Map(); // conversationId -> session

function newTicket() {
  return {
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

function getSession(context) {
  const cid = context.activity?.conversation?.id || "no-conv-id";
  const now = Date.now();

  if (!sessions.has(cid)) {
    sessions.set(cid, {
      createdAt: now,
      lastSeenAt: now,
      mode: "idle", // idle | triage | network | windows | account | app
      step: 0,
      ticket: newTicket(),
    });
  }

  const s = sessions.get(cid);
  s.lastSeenAt = now;
  return s;
}

function resetSession(session) {
  session.mode = "idle";
  session.step = 0;
  session.ticket = newTicket();
}

function cleanupSessions() {
  const now = Date.now();
  for (const [cid, s] of sessions.entries()) {
    if (now - s.lastSeenAt > CONFIG.sessionTtlMs) sessions.delete(cid);
  }
}
setInterval(cleanupSessions, 5 * 60 * 1000).unref();

// ===========================
// Classification + Flows
// ===========================
function classifyIssue(text, keyPhrases = []) {
  const t = lower(text);
  const kp = keyPhrases.map((k) => lower(k));

  const hasKP = (arr) => kp.some((x) => arr.includes(x));

  if (
    containsAny(t, ["wifi", "wi-fi", "internet", "router", "dns", "ip", "ethernet"]) ||
    hasKP(["wifi", "router", "dns", "ip", "internet"])
  ) {
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
    app: "App mode: we’ll isolate crashes/errors. First: what app + version, and what’s the exact error message?",
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

function helpText() {
  return [
    "Tech Support Copilot commands:",
    "- help : show commands",
    "- start : begin troubleshooting",
    "- reset : clear session",
    "- summary : generate ticket summary",
    "- mode network | windows | account | app | triage : force a troubleshooting mode",
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

// ===========================
// Server (Restify)
// ===========================
const server = restify.createServer();
server.use(restify.plugins.bodyParser());

// Health endpoints (Render checks / manual checks)
server.get("/healthz", (_req, res, next) => {
  res.send(200, { ok: true, time: nowISO() });
  next();
});
server.get("/", (_req, res, next) => {
  res.send(200, {
    name: "azure-intelligent-support-bot",
    status: "running",
    endpoints: ["/api/messages", "/healthz"],
    time: nowISO(),
  });
  next();
});

server.listen(CONFIG.port, () => {
  console.log(`Server running on http://localhost:${CONFIG.port}`);
  console.log(`POST endpoint: http://localhost:${CONFIG.port}/api/messages`);
});

// ===========================
// Bot Adapter
// ===========================
const adapter = new BotFrameworkAdapter({
  appId: env("BOT_APP_ID", { fallback: "" }),
  appPassword: env("BOT_APP_PASSWORD", { fallback: "" }),
});

adapter.onTurnError = async (context, err) => {
  console.error("Bot error:", err);
  try {
    await context.sendActivity("Oops — something went wrong on my end. Check server logs.");
  } catch (_) {}
};

// ===========================
// Messages endpoint
// ===========================
server.post("/api/messages", (req, res) => {
  adapter.processActivity(req, res, async (context) => {
    if (context.activity.type !== "message") return;

    // IMPORTANT (Render + Emulator):
    // If your bot is remote and activity.serviceUrl is localhost, your bot cannot reply to your local Emulator.
    // Correct fix: Configure a tunnel in Emulator (devtunnel) so serviceUrl becomes public.
    // We can also override serviceUrl if you REALLY want (advanced).
    if (
      CONFIG.emulatorTunnelServiceUrl &&
      context.activity.channelId === "emulator" &&
      isLocalhostServiceUrl(context.activity.serviceUrl)
    ) {
      context.activity.serviceUrl = CONFIG.emulatorTunnelServiceUrl;
    }

    const session = getSession(context);
    const userText = truncate(context.activity.text, CONFIG.maxTextLen);

    if (!safeTrim(userText)) {
      await context.sendActivity("Send a message and I’ll help you troubleshoot.");
      return;
    }

    // Commands
    const t = lower(userText);
    if (t === "help") return void (await context.sendActivity(helpText()));
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

    // Azure Language analysis (robust fallback)
    let analysis = null;
    try {
      analysis = await analyzeLanguage(userText);
    } catch (e) {
      console.error("Azure Language fatal error:", e);
    }

    if (analysis?.pii) {
      const piiMsg = piiWarning(analysis.pii);
      if (piiMsg) await context.sendActivity(piiMsg);
    }

    const detectedLang = analysis?.language?.primaryLanguage?.iso6391Name || "unknown";
    const sentiment = analysis?.sentiment?.sentiment || "neutral";
    const confidence = formatConfidence(analysis?.sentiment);
    const keyPhrases = analysis?.keyphrases?.keyPhrases || [];
    const topKP = keyPhrases.slice(0, 6);

    // Auto-classify if idle
    if (session.mode === "idle") {
      session.mode = classifyIssue(userText, topKP);
      session.step = 0;

      await context.sendActivity(
        `${tonePrefix(analysis?.sentiment)} (lang: ${detectedLang}, sentiment: ${sentiment}${confidence})`
      );
      await context.sendActivity(flowIntro(session.mode));

      session.ticket.issue = session.ticket.issue || truncate(userText, 160);
      if (topKP.length) uniqPush(session.ticket.symptoms, "keywords: " + topKP.join(", "));
      return;
    }

    // Store keywords (dedupe)
    if (topKP.length) uniqPush(session.ticket.symptoms, "keywords: " + topKP.join(", "));

    // ===========================
    // TRIAGE FLOW
    // ===========================
    if (session.mode === "triage") {
      if (session.step === 0) {
        session.ticket.issue = userText;
        session.step = 1;
        await context.sendActivity(`${tonePrefix(analysis?.sentiment)} Got it.`);
        await context.sendActivity("1) What device are you on? (Windows laptop / Mac / phone + model if you can)");
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
        uniqPush(session.ticket.errors, truncate(userText, 400));
        session.mode = classifyIssue((session.ticket.issue || "") + " " + userText, topKP);
        session.step = 0;
        await context.sendActivity("Perfect. Switching you into a focused troubleshooting mode:");
        await context.sendActivity(`➡️ Mode: ${session.mode}`);
        await context.sendActivity(flowIntro(session.mode));
        return;
      }
    }

    // ===========================
    // NETWORK FLOW
    // ===========================
    if (session.mode === "network") {
      if (session.step === 0) {
        session.ticket.issue = session.ticket.issue || userText;
        session.step = 1;
        await context.sendActivity("Are you on Wi-Fi or Ethernet?");
        return;
      }
      if (session.step === 1) {
        uniqPush(session.ticket.symptoms, "connection: " + truncate(userText, 120));
        session.step = 2;
        await context.sendActivity(
          "Quick checks:\nA) Can you open any website?\nB) Does it fail on ALL sites or only one?\nReply like: A=yes B=only one"
        );
        return;
      }
      if (session.step === 2) {
        uniqPush(session.ticket.symptoms, "basic check: " + truncate(userText, 200));
        session.step = 3;
        await context.sendActivity(
          "Run ONE of these (Windows):\n1) `ipconfig /all`\n2) `ping 8.8.8.8 -n 4`\n3) `nslookup google.com`\nPaste results (redact if you want)."
        );
        return;
      }
      if (session.step === 3) {
        uniqPush(session.ticket.whatTried, "network diagnostics provided");
        uniqPush(session.ticket.errors, "network output: " + truncate(userText, 400));
        session.step = 4;

        const l = lower(userText);
        if (l.includes("request timed out") || l.includes("unreachable")) {
          await context.sendActivity(
            "This looks like a connectivity path issue.\nTry:\n- Toggle Wi-Fi off/on\n- Reboot router\n- Forget network + reconnect\n- Try hotspot to confirm"
          );
        } else if (l.includes("server can't find") || l.includes("dns") || l.includes("nxdomain")) {
          await context.sendActivity(
            "This looks like DNS.\nTry:\n- `ipconfig /flushdns`\n- Temporarily set DNS to 1.1.1.1 / 8.8.8.8\n- Restart network adapter"
          );
        } else {
          await context.sendActivity(
            "Thanks. I can work with that.\nTell me: does this happen only on this device or on multiple devices?"
          );
        }

        await context.sendActivity("Type `summary` anytime to generate a ticket for IT.");
        return;
      }

      await context.sendActivity("If you want, type `summary` or `reset` or `mode triage`.");
      return;
    }

    // ===========================
    // WINDOWS FLOW
    // ===========================
    if (session.mode === "windows") {
      if (session.step === 0) {
        session.ticket.issue = session.ticket.issue || userText;
        session.step = 1;
        await context.sendActivity("What changed right before the problem? (update, new app, driver, new device)");
        return;
      }
      if (session.step === 1) {
        uniqPush(session.ticket.symptoms, "recent change: " + truncate(userText, 200));
        session.step = 2;
        await context.sendActivity(
          "Quick Windows health checks:\n1) Settings > Windows Update (any pending?)\n2) Run `sfc /scannow` (Admin CMD)\nTell me the results."
        );
        return;
      }
      if (session.step === 2) {
        uniqPush(session.ticket.whatTried, "windows update/sfc suggested");
        uniqPush(session.ticket.errors, truncate(userText, 400));
        session.step = 3;

        await context.sendActivity(
          "Next step:\n- If app crashing: reinstall + run as admin\n- If BSOD: tell me stop code + recent drivers\n- If slow: check Task Manager CPU/RAM/Disk"
        );
        await context.sendActivity("Want me to focus on: `mode app` or stay `mode windows`?");
        return;
      }

      await context.sendActivity("Type `summary` to generate a ticket, or paste the exact stop code/error.");
      return;
    }

    // ===========================
    // ACCOUNT FLOW
    // ===========================
    if (session.mode === "account") {
      if (session.step === 0) {
        session.ticket.issue = session.ticket.issue || userText;
        session.step = 1;
        await context.sendActivity("Is it Microsoft login, school SSO, or app login? (one word is fine)");
        return;
      }
      if (session.step === 1) {
        uniqPush(session.ticket.symptoms, "login type: " + truncate(userText, 120));
        session.step = 2;
        await context.sendActivity(
          "What exactly happens?\n- wrong password\n- MFA loop\n- locked out\n- ‘cannot sign in’\nPaste any error text (redacted)."
        );
        return;
      }
      if (session.step === 2) {
        uniqPush(session.ticket.errors, truncate(userText, 400));
        session.step = 3;
        await context.sendActivity(
          "Common fixes:\n- Try incognito/private window\n- Clear cookies for the domain\n- Confirm time/date auto-set\n- If MFA: re-register authenticator\nWhich ones did you already try?"
        );
        return;
      }
      if (session.step === 3) {
        uniqPush(session.ticket.whatTried, truncate(userText, 300));
        await context.sendActivity("Got it. Type `summary` and you’ll have a clean ticket to send to IT/Helpdesk.");
        return;
      }
    }

    // ===========================
    // APP FLOW
    // ===========================
    if (session.mode === "app") {
      if (session.step === 0) {
        session.ticket.issue = session.ticket.issue || userText;
        session.step = 1;
        await context.sendActivity("What app + version? (example: Chrome 122, VSCode 1.86, etc.)");
        return;
      }
      if (session.step === 1) {
        session.ticket.app = truncate(userText, 120);
        session.step = 2;
        await context.sendActivity("What’s the exact error message? (redacted)");
        return;
      }
      if (session.step === 2) {
        uniqPush(session.ticket.errors, truncate(userText, 400));
        session.step = 3;
        await context.sendActivity(
          "Quick fixes (choose what applies):\nA) Restart app + reboot PC\nB) Update app\nC) Reinstall app\nD) Run as admin\nE) Check permissions/firewall\nReply with letters: e.g. A,B,D"
        );
        return;
      }
      if (session.step === 3) {
        uniqPush(session.ticket.whatTried, "app fixes tried: " + truncate(userText, 120));
        session.step = 4;
        await context.sendActivity(
          "Nice. If it still fails, narrow it down:\n- All accounts or only yours?\n- Another device?\n- Any logs? (Event Viewer / app logs)"
        );
        await context.sendActivity("Type `summary` when you want the final ticket.");
        return;
      }

      await context.sendActivity("Type `summary` or paste what happened after trying the fixes.");
      return;
    }

    // Fallback
    await context.sendActivity("I’m here. Type `start` to begin a guided flow or `help` for commands.");
  });
});
