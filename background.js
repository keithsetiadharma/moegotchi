// Moegotchi background service worker
// Model routing: a cheap, fast model for frequent tab checks, a stronger one for the rare end-of-session recap.
// Names change over time: check aistudio.google.com.
const MODELS = { quick: "gemini-3.1-flash-lite", smart: "gemini-3.8-flash" };

// true = skip Gemini and fake a verdict from the URL, for testing the pet when the API is down
const MOCK = true;
const DISTRACTING = /youtube|reddit|twitter|x\.com|instagram|tiktok|netflix|twitch/;
// Canned lines per dere and affection band, so the mock's tone tracks affection like Gemini's does
const MOCK_LINES = {
  genki: {
    low: { on: "Oh! You're back... I missed you. Let's try, okay?", off: "Again?! I really thought you'd stay this time..." },
    mid: { on: "Yay, back on track! Keep it up!", off: "Hey hey, that's not the task! Come back!" },
    high: { on: "You're on FIRE today! I'm so proud of you!", off: "Even superstars slip! Back to work, champ!" },
  },
  tsundere: {
    low: { on: "Hmph. Don't think one tab makes up for earlier.", off: "Unbelievable. I KNEW you'd do this, baka." },
    mid: { on: "Fine. Working, I guess. Not that I care.", off: "Seriously? Close that. N-not for your sake!" },
    high: { on: "...You're doing well. Don't let it go to your head!", off: "You were doing so well, idiot! Don't ruin it!" },
  },
  yandere: {
    low: { on: "You came back to me... but I'm still counting, darling.", off: "Who is this tab? Why are you looking at it?" },
    mid: { on: "Good. Stay right here, where I can watch you~", off: "Leaving me for THAT? I saw everything~" },
    high: { on: "Perfect. Just you, me, and your work. Forever~", off: "I'll forgive you... if you leave right now~" },
  },
  kuudere: {
    low: { on: "Noted. Still disappointed.", off: "As expected." },
    mid: { on: "Acceptable.", off: "Wrong tab." },
    high: { on: "...Good work.", off: "You're better than this." },
  },
};
function mockVerdict(tab, dere, affection) {
  const on_task = !DISTRACTING.test(tab.url);
  const lines = (MOCK_LINES[dere] || MOCK_LINES.genki)[bandFor(affection)];
  return { on_task, message: `[mock] ${on_task ? lines.on : lines.off}` };
}

// Affection: the pet's persistent health (0-100). Lost fast when you slack, won back slowly by focusing.
// Tune the feel here: deltas per verdict, and per minute spent on the current tab.
const AFFECTION = { start: 50, onTask: 3, offTask: -15, perMinOn: 2, perMinOff: -3 };

function bandFor(affection) {
  return affection >= 70 ? "high" : affection >= 40 ? "mid" : "low";
}

function moodFor(affection, onTask) {
  if (!onTask) return "angry"; // caught slacking: upset right away
  return { high: "happy", mid: "neutral", low: "sad" }[bandFor(affection)]; // back on task: only as happy as you've earned
}

async function changeAffection(delta, onTask) {
  const { pet = {} } = await chrome.storage.local.get("pet");
  const affection = Math.max(0, Math.min(100, (pet.affection ?? AFFECTION.start) + delta));
  const next = { affection, mood: moodFor(affection, onTask) };
  // Saving updates the pet on every tab (content.js listens for storage changes)
  await chrome.storage.local.set({ pet: next });
  return next;
}

const DERE = {
  genki: {
    persona: "You are an upbeat, rewarding cheerleader pet. Celebrate focus, gently redirect distraction. Short, cute, max 15 words.",
    closes: false,
  },
  tsundere: {
    persona: "You are a tsundere pet. Harsh and insulting on the surface, secretly caring. Max 15 words.",
    closes: true,
  },
  yandere: {
    persona: "You are a playfully yandere pet, way too attached, always watching the user's tabs. Keep it funny, never threatening. Max 15 words.",
    closes: false,
  },
  kuudere: {
    persona: "You are a cool, deadpan, quietly disappointed pet. Minimal words, max 10 words.",
    closes: false,
  },
};

let debounce = null;

// Schemas make Gemini return exactly these fields, so the UI can trust them.
// No mood field: mood comes from affection in code, so it can't jump straight back to happy.
const VERDICT_SCHEMA = {
  type: "OBJECT",
  properties: { on_task: { type: "BOOLEAN" }, message: { type: "STRING" } },
  required: ["on_task", "message"],
};
const RECAP_SCHEMA = {
  type: "OBJECT",
  properties: { recap: { type: "STRING" } },
  required: ["recap"],
};

async function askGemini(prompt, apiKey, model, schema) {
  const request = {
    method: "POST",
    // Key in a header, not the URL: URLs end up in logs and history
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema },
    }),
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  let res, data;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, request);
    data = await res.json();
    // 503 = overloaded, usually clears in seconds, so wait and retry (2s, then 4s).
    // Not 429: that means quota is used up, and retrying can't fix it
    if (res.status !== 503 || attempt === 2) break;
    console.warn(`[moegotchi] HTTP ${res.status}, retrying in ${2 * 2 ** attempt}s`);
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  // Bad key, wrong model name, rate limit, etc. come back as {error: {...}} with no candidates
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.error?.message}`);
  // Real token counts from Gemini: prompt (input), candidates (reply), thoughts (hidden reasoning, billed as output)
  const u = data.usageMetadata || {};
  console.log(`[moegotchi] ${model} tokens: in ${u.promptTokenCount}, out ${u.candidatesTokenCount}, thinking ${u.thoughtsTokenCount ?? 0}`);
  return JSON.parse(data.candidates[0].content.parts[0].text);
}

// Send a message to the pet on this tab, injecting the content script first if the tab predates the extension
async function tell(tab, msg) {
  try {
    await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tab.id, msg);
  }
}

// Verdicts by dere + task + URL, so flipping back and forth between tabs doesn't spend quota.
// Lives in memory, so it resets whenever Chrome puts the service worker to sleep. Fine for saving quota.
const cache = new Map();

async function judge(tab) {
  const { apiKey, task, dere = "genki", pet = {} } = await chrome.storage.local.get(["apiKey", "task", "dere", "pet"]);
  if (!task || (!apiKey && !MOCK)) {
    console.log("[moegotchi] skipped: set a task and API key in the popup");
    return;
  }
  const d = DERE[dere] || DERE.genki;
  const affection = pet.affection ?? AFFECTION.start;

  const prompt =
    `${d.persona}\n` +
    `Your affection for the user: ${affection}/100. Below 40 you're still upset with them and they must win you back, ` +
    `even while they're on task; above 70 you adore them. Let it show in your tone.\n` +
    `The user's current task: "${task}"\n` +
    `Their current tab: title="${tab.title}" url="${tab.url}"\n` +
    `Decide if this tab plausibly helps with the task (a lecture video on the task topic is on task; unrelated videos/social media are not). ` +
    `Reply as JSON: {"on_task": boolean, "message": string}`;

  try {
    // Affection band is in the key so a cached line's tone still matches how upset the pet is
    const key = `${dere}|${task}|${bandFor(affection)}|${tab.url}`;
    let verdict = cache.get(key);
    if (!verdict) {
      // Show the pet is thinking right away (text only, the mood stays)
      tell(tab, { type: "say", message: "hmm..." }).catch(() => {});
      verdict = MOCK ? mockVerdict(tab, dere, affection) : await askGemini(prompt, apiKey, MODELS.quick, VERDICT_SCHEMA);
      cache.set(key, verdict);
    }
    console.log("[moegotchi]", tab.title, verdict);
    // Session log for the recap: one entry per verdict, so time on a tab = gap until the next entry
    const { log = [] } = await chrome.storage.local.get("log");
    log.push({ t: Date.now(), title: (tab.title || tab.url).slice(0, 60), on_task: verdict.on_task });
    await chrome.storage.local.set({ log: log.slice(-100) });
    const next = await changeAffection(verdict.on_task ? AFFECTION.onTask : AFFECTION.offTask, verdict.on_task);
    await tell(tab, { type: "verdict", ...verdict, mood: next.mood, willClose: d.closes && !verdict.on_task });
  } catch (e) {
    console.error("[moegotchi] judge failed", e);
    // Surface the failure on the pet too: the service worker console is easy to miss
    tell(tab, { type: "say", message: `Couldn't reach Gemini: ${e.message.slice(0, 80)}` }).catch(() => {});
  }
}

// End-of-session recap, written by the smart model from the session log
async function recap() {
  const { apiKey, task, dere = "genki", log = [], sessionStart, pet = {} } = await chrome.storage.local.get(
    ["apiKey", "task", "dere", "log", "sessionStart", "pet"]
  );
  if (!log.length) return { recap: "Nothing to recap yet. Click Start focusing, then switch some tabs!" };

  // Do the math in code, not in the prompt: models are unreliable at arithmetic
  const now = Date.now();
  let onMs = 0, offMs = 0;
  log.forEach((e, i) => {
    const ms = (log[i + 1]?.t ?? now) - e.t;
    if (e.on_task) onMs += ms;
    else offMs += ms;
  });
  const mins = (ms) => Math.round(ms / 60000);
  const focus = Math.round((100 * onMs) / (onMs + offMs || 1));
  const stats = `${mins(now - (sessionStart ?? log[0].t))} min session, ${mins(onMs)} on task, ${mins(offMs)} off (${focus}% focused), affection ${pet.affection ?? AFFECTION.start}/100`;

  let result;
  if (MOCK) {
    result = { recap: "[mock] Session over! Here's how you did." };
  } else {
    const time = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const timeline = log.map((e) => `${time(e.t)} ${e.on_task ? "ON " : "OFF"} ${e.title}`).join("\n");
    const prompt =
      `${DERE[dere]?.persona || DERE.genki.persona}\n` +
      `Stay in character, but ignore the word limit: write a 3-4 sentence end-of-session recap.\n` +
      `The user's task: "${task}"\nStats: ${stats}\nTab timeline:\n${timeline}\n` +
      `Praise what went well, call out the biggest distraction by name, and give one tip for next session.`;
    result = await askGemini(prompt, apiKey, MODELS.smart, RECAP_SCHEMA);
  }
  const out = { ...result, stats };
  // Saved so the popup can show it even if it was closed while Gemini was writing.
  // Clearing the log ends the session, which also stops the affection tick.
  await chrome.storage.local.set({ lastRecap: out, log: [] });
  return out;
}

function schedule(tabId) {
  clearTimeout(debounce);
  debounce = setTimeout(async () => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab && tab.active && tab.url && tab.url.startsWith("http")) judge(tab);
  }, 3000); // only judge once a tab has "settled" (saves free-tier rate limit)
}

// Every minute of a session, the tab you're sitting on slowly wins back (or loses) affection.
// Only create the alarm if missing: re-creating it on every service worker wake-up would reset its timer
// and, with frequent wake-ups, it would never fire.
chrome.alarms.get("tick").then((a) => a || chrome.alarms.create("tick", { periodInMinutes: 1 }));
chrome.alarms.onAlarm.addListener(async () => {
  const { log = [] } = await chrome.storage.local.get("log");
  const last = log.at(-1);
  if (!last) return; // no session running
  await changeAffection(last.on_task ? AFFECTION.perMinOn : AFFECTION.perMinOff, last.on_task);
});

chrome.tabs.onActivated.addListener(({ tabId }) => schedule(tabId));
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  // Only the active tab: a background tab finishing its load would otherwise cancel the pending judge
  if (info.status === "complete" && tab.active) schedule(tabId);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Popup asks for a recap
  if (msg.type === "recap") {
    recap().then(sendResponse, (e) => sendResponse({ error: e.message }));
    return true; // keeps the message channel open until the async Gemini call answers
  }
  // Content script asks us to close the tab after the countdown
  if (msg.type === "closeMe" && sender.tab) {
    chrome.storage.local.get("closed").then(({ closed = [] }) => {
      closed.unshift({ url: sender.tab.url, title: sender.tab.title });
      chrome.storage.local.set({ closed: closed.slice(0, 10) });
      chrome.tabs.remove(sender.tab.id);
    });
  }
});
