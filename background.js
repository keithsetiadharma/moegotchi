// Moegotchi background service worker
// Model routing: a cheap, fast model for frequent tab checks, a stronger one for the rare end-of-session recap.
// Names change over time: check aistudio.google.com.
const MODELS = { quick: "gemini-3.1-flash-lite", smart: "gemini-3.8-flash" };

// true = skip Gemini and fake a verdict from the URL, for testing the pet when the API is down
const MOCK = false;
// True if the URL is on one of these domains or their subdomains (www., m., ...).
// Matching the hostname, not raw text: a plain /x\.com/ would also match "dropbox.com".
function onSite(url, domains) {
  const host = new URL(url).hostname;
  return domains.some((d) => host === d || host.endsWith("." + d));
}
const DISTRACTING = ["youtube.com", "reddit.com", "twitter.com", "x.com", "instagram.com", "tiktok.com", "netflix.com", "twitch.tv"];
// Mock lines come from the persona's mockLines (per affection band), so the mock's tone tracks affection like Gemini's does.
// A persona without mockLines gets generic ones instead of crashing mock mode.
function mockVerdict(tab, persona, affection) {
  const on_task = !onSite(tab.url, DISTRACTING);
  const lines = persona.mockLines?.[bandFor(affection)] || { on: "Nice, back to work!", off: "Hey, that's off task." };
  return { on_task, messages: [`[mock] ${on_task ? lines.on : lines.off}`] };
}

// Affection: the pet's persistent health (0-100). Lost fast when you slack, won back slowly by focusing.
// Tune the feel here: deltas per verdict, and per minute spent on the current tab.
// offTask = getting caught (switching from work to a distraction); offTaskAgain = each further distraction page (every Short, every video)
const AFFECTION = { start: 50, onTask: 3, offTask: -15, offTaskAgain: -10, perMinOn: 2, perMinOff: -3 };

function bandFor(affection) {
  return affection >= 70 ? "high" : affection >= 40 ? "mid" : "low";
}

function moodFor(affection, onTask) {
  if (!onTask) return "angry"; // caught slacking: upset right away
  return { high: "happy", mid: "neutral", low: "sad" }[bandFor(affection)]; // back on task: only as happy as you've earned
}

// Changes run one at a time: storage reads and writes are async, so two overlapping changes could both read 50,
// both write 40, and one -10 would be lost. Each change waits for the previous one to finish.
let affectionQueue = Promise.resolve();
function changeAffection(delta, onTask) {
  const run = affectionQueue.then(async () => {
    const { pet = {} } = await chrome.storage.local.get("pet");
    const affection = Math.max(0, Math.min(100, (pet.affection ?? AFFECTION.start) + delta));
    const next = { affection, mood: moodFor(affection, onTask) };
    // Saving updates the pet on every tab (content.js listens for storage changes)
    await chrome.storage.local.set({ pet: next });
    return next;
  });
  affectionQueue = run.catch(() => {});
  return run;
}

// Personas live in personas/<id>/persona.json, listed in personas/index.json. Loaded once each time the
// service worker starts. A persona that fails to load is skipped (logged) instead of breaking the others.
async function loadPersonas() {
  const getJSON = async (path) => (await fetch(chrome.runtime.getURL(path))).json();
  const ids = await getJSON("personas/index.json");
  const results = await Promise.allSettled(ids.map((id) => getJSON(`personas/${id}/persona.json`)));
  const personas = {};
  results.forEach((r, i) => {
    if (r.status === "fulfilled") personas[ids[i]] = r.value;
    else console.error(`[moegotchi] couldn't load persona "${ids[i]}"`, r.reason);
  });
  return personas;
}
const personasReady = loadPersonas();

// The persona's personality prompt: "voice" (current format), or "prompt" (older persona files)
const voiceOf = (p) => p.voice ?? p.prompt;

// Unknown or missing id falls back to the first persona in personas/index.json that loaded
async function getPersona(id) {
  const all = await personasReady;
  return all[id] || Object.values(all)[0];
}

let debounce = null;

// Schemas make Gemini return exactly these fields, so the UI can trust them.
// No mood field: mood comes from affection in code, so it can't jump straight back to happy.
const VERDICT_SCHEMA = {
  type: "OBJECT",
  // Several lines per call: the pet rotates through them on repeat visits, so it doesn't repeat itself
  // sure: false = "the text wasn't enough to tell", which triggers a second look with a screenshot
  properties: { on_task: { type: "BOOLEAN" }, sure: { type: "BOOLEAN" }, messages: { type: "ARRAY", items: { type: "STRING" } } },
  required: ["on_task", "sure", "messages"],
};
const RECAP_SCHEMA = {
  type: "OBJECT",
  properties: { recap: { type: "STRING" } },
  required: ["recap"],
};

// image: optional base64 JPEG sent alongside the prompt (Gemini is multimodal)
async function askGemini(prompt, apiKey, model, schema, image) {
  const parts = [{ text: prompt }];
  if (image) parts.push({ inline_data: { mime_type: "image/jpeg", data: image } });
  const request = {
    method: "POST",
    // Key in a header, not the URL: URLs end up in logs and history
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts }],
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
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  // e.g. a safety block: there's a response, but no answer in it
  if (!text) throw new Error(`Gemini gave no answer (${data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || "unknown"})`);
  return JSON.parse(text);
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

// Always off task, whatever the content: Gemini only writes the reaction, no screenshot needed
const ALWAYS_OFF = ["tiktok.com", "instagram.com", "twitch.tv", "twitter.com", "x.com", "netflix.com"];
// The ONLY sites that can ever be screenshotted: video sites, where the title can't tell a lecture from a MrBeast video.
// An allowlist is the privacy guarantee: email, banking, or any site not listed here never leaves the browser as an image.
const SCREENSHOT_SITES = ["youtube.com", "vimeo.com"];

// Cheap text clues from the page itself: its description, and on YouTube the channel name.
// deep = also the page's main headings, for a second look when Gemini wasn't sure.
async function pageContext(tab, deep = false) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [deep],
      func: (deep) => {
        const meta = (n) => document.querySelector(`meta[name="${n}"], meta[property="${n}"]`)?.content || "";
        const channel = document.querySelector("ytd-watch-metadata ytd-channel-name a, ytd-reel-video-renderer[is-active] ytd-channel-name a")?.textContent;
        const headings = deep && [...document.querySelectorAll("h1, h2")].slice(0, 5).map((h) => h.textContent.trim()).filter(Boolean).join(" / ");
        return [channel && `channel: ${channel.trim()}`, meta("description") || meta("og:description"), headings && `headings: ${headings}`]
          .filter(Boolean).join(" | ");
      },
    });
    return (result || "").slice(0, deep ? 600 : 300);
  } catch {
    return ""; // pages we can't script (Web Store etc.): judge on title and URL alone
  }
}

// Screenshot of the visible tab, shrunk to 640px wide so it costs a few hundred tokens instead of thousands
async function screenshot(tab) {
  try {
    // captureVisibleTab grabs whatever is on screen, so make sure it's still this tab
    if (!(await chrome.tabs.get(tab.id)).active) return null;
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 });
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const scale = Math.min(1, 640 / bitmap.width);
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality: 0.6 })).arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary); // base64, chunked because spreading a whole image into one call overflows the stack
  } catch (e) {
    console.warn("[moegotchi] screenshot failed, judging without it", e);
    return null;
  }
}

// Random line from a verdict, avoiding the one shown last time
let lastLine = "";
function pickLine(lines = []) {
  const options = lines.filter((l) => l !== lastLine);
  lastLine = options[Math.floor(Math.random() * options.length)] ?? lines[0] ?? "...";
  return lastLine;
}

// Verdicts by dere + task + URL, so flipping back and forth between tabs doesn't spend quota.
// Lives in memory, so it resets whenever Chrome puts the service worker to sleep. Fine for saving quota.
const cache = new Map();

async function judge(tab) {
  const { apiKey, task, dere, pet = {} } = await chrome.storage.local.get(["apiKey", "task", "dere", "pet"]);
  if (!task || (!apiKey && !MOCK)) {
    console.log("[moegotchi] skipped: set a task and API key in the popup");
    return;
  }
  const d = await getPersona(dere);
  const affection = pet.affection ?? AFFECTION.start;

  try {
    // Affection band is in the key so a cached line's tone still matches how upset the pet is.
    // Title too: a Google Doc keeps its URL while you type, so "Untitled document" and "Binary tree notes"
    // must not share a cached verdict.
    const key = `${dere}|${task}|${bandFor(affection)}|${tab.url}|${tab.title}`;
    let verdict = cache.get(key);
    if (!verdict) {
      // Show the pet is thinking right away (text only, the mood stays)
      tell(tab, { type: "say", message: "hmm...", thinking: true }).catch(() => {});
      if (MOCK) verdict = mockVerdict(tab, d, affection);
      else {
        // Only gathered on a cache miss: no point paying for a screenshot we won't send
        let context = await pageContext(tab);
        const alwaysOff = onSite(tab.url, ALWAYS_OFF);
        const ask = (image) => {
          const prompt =
            `${voiceOf(d)}\n` +
            `Your affection for the user: ${affection}/100. Below 40 you're still upset with them and they must win you back, ` +
            `even while they're on task; above 70 you adore them. Let it show in your tone.\n` +
            `The user's current task: "${task}"\n` +
            `Their current tab: title="${tab.title}" url="${tab.url}"\n` +
            (context ? `Page details: ${context}\n` : "") +
            (image ? `A screenshot of the tab is attached. Ignore the small pet widget in the bottom-right corner.\n` : "") +
            (alwaysOff
              ? `This site is always a distraction: on_task is false and sure is true.\n`
              : `Decide if this tab plausibly helps with the task. Judge the actual content, not the site: ` +
                `a lecture or tutorial on the task topic is on task even on YouTube; entertainment, vlogs, memes and social feeds are not. ` +
                `Give the benefit of the doubt: tools for doing work (documents, notes, code editors, search engines, course sites) ` +
                `are on task even when blank or untitled, since the user may be just starting. Only mark off task when it's clearly a distraction. ` +
                `Set sure to false only if the title, URL and details aren't enough to tell, and then write lines that assume they're working.\n`) +
            `Reply as JSON: {"on_task": boolean, "sure": boolean, "messages": [4 different lines reacting to this tab, each with different wording]}`;
          console.log("[moegotchi] judging", tab.url, image ? "with screenshot" : "text only", context ? `| ${context}` : "");
          return askGemini(prompt, apiKey, MODELS.quick, VERDICT_SCHEMA, image);
        };

        if (alwaysOff) verdict = { ...(await ask(null)), on_task: false };
        else if (onSite(tab.url, SCREENSHOT_SITES)) verdict = await ask(await screenshot(tab));
        else {
          verdict = await ask(null);
          // Text wasn't enough: take a second look with more page text (headings). Never a screenshot here,
          // since this could be any site, including private ones.
          if (verdict.sure === false) {
            context = await pageContext(tab, true);
            verdict = await ask(null);
          }
          // Still unsure: assume they're working. Wrongly scolding someone mid-work is far worse than missing a slack-off.
          if (verdict.sure === false) verdict = { ...verdict, on_task: true };
        }
      }
      cache.set(key, verdict);
    }
    console.log("[moegotchi]", tab.title, verdict);
    // Session log for the recap: one entry per verdict, so time on a tab = gap until the next entry.
    // The log keeps only the last 100 entries (for the recap's timeline), so time totals are kept separately:
    // otherwise a long Shorts binge (one entry per Short) would push early time out of the stats.
    const { log = [], totals = { onMs: 0, offMs: 0 } } = await chrome.storage.local.get(["log", "totals"]);
    const prev = log.at(-1);
    const now = Date.now();
    if (prev) totals[prev.on_task ? "onMs" : "offMs"] += now - prev.t;
    log.push({ t: now, title: (tab.title || tab.url).slice(0, 60), on_task: verdict.on_task });
    await chrome.storage.local.set({ log: log.slice(-100), totals });
    // Off task: -15 for getting caught, then -10 for every further distraction page (each Short counts).
    // On task: +3 only when coming back, so flipping between work tabs can't farm affection; the minute tick rewards staying.
    const switched = !prev || prev.on_task !== verdict.on_task;
    const delta = verdict.on_task
      ? switched ? AFFECTION.onTask : 0
      : switched ? AFFECTION.offTask : AFFECTION.offTaskAgain;
    const next = await changeAffection(delta, verdict.on_task);
    await tell(tab, {
      type: "verdict",
      on_task: verdict.on_task,
      url: tab.url, // which page this verdict is about (for "I need this tab!" sparing)
      message: pickLine(verdict.messages),
      mood: next.mood,
      // Only close tabs when Gemini is sure it's a distraction: closing a tab you needed is the costliest mistake
      willClose: d.closesTabs && !verdict.on_task && verdict.sure !== false,
      countdownSec: d.countdownSec || 10, // how long before the tab closes (persona.json, default 10)
    });
  } catch (e) {
    console.error("[moegotchi] judge failed", e);
    // Surface the failure on the pet too: the service worker console is easy to miss
    tell(tab, { type: "say", message: `Couldn't reach Gemini: ${e.message.slice(0, 80)}` }).catch(() => {});
  }
}

// End-of-session recap, written by the smart model from the session log
async function recap() {
  const { apiKey, task, dere, log = [], totals = { onMs: 0, offMs: 0 }, sessionStart, pet = {} } =
    await chrome.storage.local.get(["apiKey", "task", "dere", "log", "totals", "sessionStart", "pet"]);
  if (!log.length) return { recap: "Nothing to recap yet. Click Start focusing, then switch some tabs!" };

  // Do the math in code, not in the prompt: models are unreliable at arithmetic
  // Closed entries are already in totals; add the one still open (from the last verdict until now)
  const now = Date.now();
  let { onMs, offMs } = totals;
  const last = log.at(-1);
  if (last.on_task) onMs += now - last.t;
  else offMs += now - last.t;
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
      `${voiceOf(await getPersona(dere))}\n` +
      `Stay in character, but ignore the word limit: write a 3-4 sentence end-of-session recap.\n` +
      `The user's task: "${task}"\nStats: ${stats}\nTab timeline:\n${timeline}\n` +
      `Praise what went well, call out the biggest distraction by name, and give one tip for next session.`;
    result = await askGemini(prompt, apiKey, MODELS.smart, RECAP_SCHEMA);
  }
  const out = { ...result, stats };
  // Saved so the popup can show it even if it was closed while Gemini was writing.
  // Clearing the log ends the session, which also stops the affection tick.
  await chrome.storage.local.set({ lastRecap: out, log: [], totals: { onMs: 0, offMs: 0 } });
  return out;
}

// Judge once a tab has "settled" for 3s (saves quota), but never wait more than 6s in total:
// otherwise non-stop scrolling through Shorts would keep resetting the timer and never get judged.
let pendingSince = 0;
function schedule(tabId) {
  clearTimeout(debounce);
  pendingSince ||= Date.now();
  const wait = Math.min(3000, Math.max(0, pendingSince + 6000 - Date.now()));
  debounce = setTimeout(() => {
    pendingSince = 0;
    runJudge(tabId);
  }, wait);
}

// Only one judge at a time. If a new one is requested while Gemini is still answering, remember just the
// latest tab and judge it right after: overlapping judges would interleave their log and affection updates.
let judging = false, nextTabId = null;
async function runJudge(tabId) {
  if (judging) {
    nextTabId = tabId;
    return;
  }
  judging = true;
  try {
    // Re-read the tab: its URL may have changed since the event (it's whatever you're on now that counts)
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab && tab.active && tab.url && tab.url.startsWith("http")) await judge(tab);
  } finally {
    judging = false;
    if (nextTabId !== null) {
      const id = nextTabId;
      nextTabId = null;
      runJudge(id);
    }
  }
}

// Every minute of a session, the tab you're sitting on slowly wins back (or loses) affection.
// Only create the alarm if missing: re-creating it on every service worker wake-up would reset its timer
// and, with frequent wake-ups, it would never fire.
chrome.alarms.get("tick").then((a) => a || chrome.alarms.create("tick", { periodInMinutes: 1 }));
chrome.alarms.onAlarm.addListener(async () => {
  const { log = [] } = await chrome.storage.local.get("log");
  const last = log.at(-1);
  if (!last) return; // no session running
  // Only count minutes you actually spend in Chrome: not while away from the computer (no input for 5 min,
  // or screen locked), and not while another app is in front. Otherwise a YouTube tab left open overnight drains her to 0.
  if ((await chrome.idle.queryState(300)) !== "active") return;
  if (!(await chrome.windows.getLastFocused().catch(() => null))?.focused) return;
  await changeAffection(last.on_task ? AFFECTION.perMinOn : AFFECTION.perMinOff, last.on_task);
});

chrome.tabs.onActivated.addListener(({ tabId }) => schedule(tabId));
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  // Only the active tab: a background tab finishing its load would otherwise cancel the pending judge.
  // info.url catches in-page navigation (YouTube, Docs, etc. change the URL without a full page load)
  if (tab.active && (info.status === "complete" || info.url)) schedule(tabId);
});
// Switching between Chrome windows doesn't fire onActivated, so check the newly focused window's tab
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return; // Chrome lost focus to another app
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab) schedule(tab.id);
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
