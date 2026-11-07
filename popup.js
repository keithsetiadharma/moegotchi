const $ = (id) => document.getElementById(id);

chrome.storage.local.get(["task", "dere", "apiKey", "closed", "lastRecap"]).then((s) => {
  $("task").value = s.task || "";
  $("dere").value = s.dere || "genki";
  $("apiKey").value = s.apiKey || "";
  renderClosed(s.closed || []);
  if (s.lastRecap) renderRecap(s.lastRecap);
});

$("save").onclick = async () => {
  await chrome.storage.local.set({
    task: $("task").value.trim(),
    dere: $("dere").value,
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
  el.append("Closed tabs (click to restore):");
  closed.forEach((t) => {
    const a = document.createElement("div");
    a.textContent = "↩ " + (t.title || t.url).slice(0, 35);
    a.style.cssText = "cursor:pointer;color:#06c;margin-top:2px";
    a.onclick = () => chrome.tabs.create({ url: t.url });
    el.append(a);
  });
}

$("end").onclick = async () => {
  $("end").textContent = "Writing your recap...";
  const r = await chrome.runtime.sendMessage({ type: "recap" });
  $("end").textContent = "End session & recap";
  if (r.error) $("recap").textContent = "Recap failed: " + r.error;
  else renderRecap(r);
};

function renderRecap(r) {
  const el = $("recap");
  el.textContent = r.recap;
  if (r.stats) {
    const small = document.createElement("small");
    small.textContent = "\n" + r.stats;
    el.append(small);
  }
}
