const $ = (id) => document.getElementById(id);
// Fallback everywhere = the first persona in personas/index.json (its tile is first)
const firstDere = () => document.querySelector('input[name="dere"]')?.value;
const getDere = () => document.querySelector('input[name="dere"]:checked')?.value || firstDere();
const setDere = (d) => {
  const tile = $(`d-${d}`) || document.querySelector('input[name="dere"]');
  if (tile) tile.checked = true;
};

$("bar").innerHTML = '<div class="seg"></div>'.repeat(10);

// Personas live in personas/<id>/persona.json, listed in personas/index.json. One that fails to load is skipped.
async function loadPersonas() {
  const getJSON = async (path) => (await fetch(chrome.runtime.getURL(path))).json();
  const ids = await getJSON("personas/index.json");
  const results = await Promise.allSettled(ids.map((id) => getJSON(`personas/${id}/persona.json`)));
  const personas = {};
  results.forEach((r, i) => r.status === "fulfilled" && (personas[ids[i]] = r.value));
  return personas;
}

// One radio tile per persona (textContent, not innerHTML: persona files are data, not markup)
function renderDereTiles() {
  for (const [id, p] of Object.entries(personas)) {
    const input = Object.assign(document.createElement("input"), { type: "radio", name: "dere", id: `d-${id}`, value: id });
    const label = document.createElement("label");
    label.htmlFor = input.id;
    const name = document.createElement("b");
    name.textContent = p.name || id;
    const tagline = document.createElement("span");
    tagline.textContent = p.tagline || "";
    label.append(name, tagline);
    $("dere").append(input, label);
  }
}

// Header sprite: the saved persona's image for the current mood, neutral if that mood has no image
let personas = {};
let shownDere = null;
let shownPet = {};
function personaImage(id, mood) {
  const pid = personas[id] ? id : firstDere();
  const images = personas[pid]?.images || {};
  const file = images[mood] || images.neutral;
  return file ? chrome.runtime.getURL(`personas/${pid}/${file}`) : "";
}
$("petSprite").onerror = function () {
  const neutral = personaImage(shownDere, "neutral");
  if (neutral && this.src !== neutral) this.src = neutral;
};

(async () => {
  personas = await loadPersonas();
  renderDereTiles();
  const s = await chrome.storage.local.get(["task", "dere", "apiKey", "closed", "lastRecap", "pet"]);
  $("task").value = s.task || "";
  shownDere = s.dere || firstDere();
  setDere(shownDere);
  $("apiKey").value = s.apiKey || "";
  // Key already saved: tuck the field away; no key yet: show it open so it's not missed
  $("keyBox").open = !s.apiKey;
  $("keyLabel").textContent = s.apiKey ? "Gemini API key ✓ saved" : "Gemini API key";
  renderPet(s.pet || {});
  renderClosed(s.closed || []);
  if (s.lastRecap) renderRecap(s.lastRecap);
})();
chrome.storage.onChanged.addListener((c) => {
  if (c.dere) shownDere = c.dere.newValue || firstDere();
  if (c.pet?.newValue || c.dere) renderPet(c.pet?.newValue || shownPet);
});

function renderPet(pet) {
  shownPet = pet;
  const { mood = "neutral", affection = 50 } = pet;
  $("petSprite").src = personaImage(shownDere, mood);
  $("petSprite").classList.toggle("smooth", personas[shownDere]?.pixelArt === false);
  // Partial segments, same as the pet widget: each segment is 10 points
  const color = affection >= 70 ? "var(--high)" : affection >= 40 ? "var(--pink)" : "var(--low)";
  document.querySelectorAll(".seg").forEach((s, i) => {
    const px = Math.round((Math.max(0, Math.min(10, affection - i * 10)) / 10) * 8);
    s.style.background = `linear-gradient(to right, ${color} ${px}px, var(--empty) ${px}px)`;
  });
  $("affNum").textContent = `${affection}/100`;
  $("petLine").textContent = affection >= 70 ? "Adores you ♥" : affection >= 40 ? "Keeping an eye on you" : "Still upset with you...";
}

$("save").onclick = async () => {
  await chrome.storage.local.set({
    task: $("task").value.trim(),
    dere: getDere(),
    apiKey: $("apiKey").value.trim(),
    // A fresh session: clear the log the recap is built from
    sessionStart: Date.now(),
    log: [],
    totals: { onMs: 0, offMs: 0 },
  });
  $("save").textContent = "Saved! Get to work.";
};

function renderClosed(closed) {
  const el = $("closed");
  el.innerHTML = "";
  if (!closed.length) return;
  const title = document.createElement("span");
  title.className = "label";
  title.textContent = "Closed tabs (click to restore)";
  el.append(title);
  closed.forEach((t) => {
    const a = document.createElement("a");
    a.textContent = "↩ " + (t.title || t.url);
    a.title = t.url;
    a.onclick = () => chrome.tabs.create({ url: t.url });
    el.append(a);
  });
}

$("end").onclick = async () => {
  $("end").textContent = "Writing your recap...";
  const r = await chrome.runtime.sendMessage({ type: "recap" });
  $("end").textContent = "End session & recap";
  if (r.error) renderRecap({ recap: "Recap failed: " + r.error });
  else renderRecap(r);
};

function renderRecap(r) {
  const el = $("recap");
  el.innerHTML = "";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "Session recap";
  const p = document.createElement("p");
  p.textContent = r.recap;
  el.append(label, p);
  if (r.stats) {
    // "30 min session, 24 on task, ..." -> one chip per stat
    const chips = document.createElement("div");
    chips.className = "chips";
    for (const part of r.stats.split(/,\s*/)) {
      const c = document.createElement("span");
      c.className = "chip";
      c.textContent = part;
      chips.append(c);
    }
    el.append(chips);
  }
}

// Users can limit an extension's site access to "On click" in chrome://extensions. Detect it and offer to fix it:
// without it the pet can't appear on pages (tab judging still works, since titles and URLs come from the tabs permission).
const ALL_SITES = { origins: ["<all_urls>"] };
chrome.permissions.contains(ALL_SITES).then((ok) => ($("access").hidden = ok));
$("grant").onclick = async () => {
  if (await chrome.permissions.request(ALL_SITES)) $("access").hidden = true;
};
