const $ = (id) => document.getElementById(id);
const getDere = () => document.querySelector('input[name="dere"]:checked')?.value || "genki";
const setDere = (d) => (($(`d-${d}`) || $("d-genki")).checked = true);

$("bar").innerHTML = '<div class="seg"></div>'.repeat(10);

chrome.storage.local.get(["task", "dere", "apiKey", "closed", "lastRecap", "pet"]).then((s) => {
  $("task").value = s.task || "";
  setDere(s.dere || "genki");
  $("apiKey").value = s.apiKey || "";
  // Key already saved: tuck the field away; no key yet: show it open so it's not missed
  $("keyBox").open = !s.apiKey;
  $("keyLabel").textContent = s.apiKey ? "Gemini API key ✓ saved" : "Gemini API key";
  renderPet(s.pet || {});
  renderClosed(s.closed || []);
  if (s.lastRecap) renderRecap(s.lastRecap);
});
chrome.storage.onChanged.addListener((c) => c.pet?.newValue && renderPet(c.pet.newValue));

function renderPet({ mood = "neutral", affection = 50 }) {
  $("petSprite").src = `sprites/${mood}.svg`;
  const lit = Math.round(affection / 10);
  document.querySelectorAll(".seg").forEach((s, i) => s.classList.toggle("on", i < lit));
  $("bar").style.setProperty("--seg", affection >= 70 ? "var(--high)" : affection >= 40 ? "var(--pink)" : "var(--low)");
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
