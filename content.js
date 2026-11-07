// Moegotchi content script: the pet that lives on every page
(() => {
  if (window.__moegotchi) return;
  window.__moegotchi = true;

  // Mood sprites live in sprites/ (listed in web_accessible_resources). Swap the files or extension freely.
  const SPRITES = {
    happy: "sprites/happy.svg",
    neutral: "sprites/neutral.svg",
    sad: "sprites/sad.svg",
    angry: "sprites/angry.svg",
  };
  // Text fallback if a sprite fails to load
  const FACES = { happy: "(◕‿◕)", neutral: "(•‿•)", sad: "(╥﹏╥)", angry: "(╬ಠ益ಠ)" };
  const URLS = {};
  for (const [mood, path] of Object.entries(SPRITES)) {
    URLS[mood] = chrome.runtime.getURL(path);
    new Image().src = URLS[mood]; // preload so mood swaps don't flicker
  }

  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;bottom:16px;right:16px;z-index:2147483647;font-family:system-ui,sans-serif;" +
    "background:#fff;border:2px solid #333;border-radius:16px;padding:10px 14px;max-width:240px;" +
    "box-shadow:0 4px 12px rgba(0,0,0,.25);color:#222;text-align:center;";
  const face = document.createElement("div");
  face.style.cssText = "font-size:32px;line-height:1.2";
  const sprite = document.createElement("img");
  // all:initial so the host page's img CSS can't resize or restyle the pet
  sprite.style.cssText = "all:initial;display:block;margin:0 auto;width:96px;height:96px;image-rendering:pixelated";
  const fallback = document.createElement("span");
  fallback.style.display = "none";
  face.append(sprite, fallback);
  sprite.onload = () => {
    sprite.style.display = "block";
    fallback.style.display = "none";
  };
  sprite.onerror = () => {
    sprite.style.display = "none";
    fallback.style.display = "inline";
  };

  function setMood(m) {
    const mood = SPRITES[m] ? m : "neutral";
    fallback.textContent = FACES[mood];
    sprite.src = URLS[mood];
  }
  // Affection bar: the pet's persistent health
  const bar = document.createElement("div");
  bar.title = "affection";
  bar.style.cssText = "width:96px;height:6px;background:#eee;border:1px solid #333;border-radius:4px;overflow:hidden";
  const fill = document.createElement("div");
  fill.style.cssText = "height:100%;width:50%;background:#f69;transition:width .5s";
  bar.append(fill);
  function setAffection(a) {
    fill.style.width = `${a ?? 50}%`;
  }
  // Floating "+3%" / "-15%" next to the bar whenever affection changes, fading out after a moment
  const delta = document.createElement("span");
  delta.style.cssText =
    "position:absolute;left:calc(50% + 52px);top:50%;transform:translateY(-50%);" +
    "font-size:11px;font-weight:700;white-space:nowrap;opacity:0;transition:opacity .4s";
  let deltaTimer = null;
  function showDelta(d) {
    if (!d) return;
    delta.textContent = `${d > 0 ? "+" : ""}${d}%`;
    delta.style.color = d > 0 ? "#2a2" : "#d22";
    delta.style.opacity = "1";
    clearTimeout(deltaTimer);
    deltaTimer = setTimeout(() => (delta.style.opacity = "0"), 1500);
  }
  // Bar centered under the sprite; delta positioned just right of it so it never shifts the bar
  const barRow = document.createElement("div");
  barRow.style.cssText = "position:relative;display:flex;justify-content:center;margin-top:4px";
  barRow.append(bar, delta);

  const msg = document.createElement("div");
  msg.style.cssText = "font-size:13px;margin-top:4px";
  const btn = document.createElement("button");
  btn.textContent = "I need this tab!";
  btn.style.cssText = "display:none;margin-top:6px;cursor:pointer";
  box.append(face, barRow, msg, btn);
  document.documentElement.appendChild(box);

  // One pet shared by every tab: start from the last saved mood, and follow mood changes made from any tab
  chrome.storage.local.get("pet").then(({ pet }) => {
    setMood(pet?.mood);
    setAffection(pet?.affection);
  });
  chrome.storage.onChanged.addListener((changes) => {
    const pet = changes.pet?.newValue;
    if (pet) {
      setMood(pet.mood);
      setAffection(pet.affection);
      showDelta(pet.affection - (changes.pet.oldValue?.affection ?? pet.affection));
    }
  });

  let timer = null;
  function clearCountdown() {
    clearInterval(timer);
    btn.style.display = "none";
  }

  chrome.runtime.onMessage.addListener((m) => {
    // "say" = status text only ("hmm...", errors); the mood stays as it was
    if (m.type === "say") msg.textContent = m.message;
    if (m.type !== "verdict") return;
    clearCountdown();
    setMood(m.mood);
    msg.textContent = m.message || "";

    if (m.willClose) {
      let n = 10;
      btn.style.display = "inline-block";
      btn.onclick = () => {
        clearCountdown();
        msg.textContent = "...fine. Don't make me regret this.";
      };
      timer = setInterval(() => {
        msg.textContent = `${m.message} (closing in ${n}s)`;
        if (n-- <= 0) {
          clearCountdown();
          chrome.runtime.sendMessage({ type: "closeMe" });
        }
      }, 1000);
    }
  });
})();
