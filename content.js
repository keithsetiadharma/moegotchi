// Moegotchi content script: the pet that lives on every page
(() => {
  if (window.__moegotchi) return;
  window.__moegotchi = true;

  const MOODS = ["happy", "neutral", "sad", "angry"];
  // Text fallback if no sprite can load at all
  const FACES = { happy: "(◕‿◕)", neutral: "(•‿•)", sad: "(╥﹏╥)", angry: "(╬ಠ益ಠ)" };

  // The selected persona (personas/<id>/persona.json): its mood images, and what it says when you pet it.
  // Petting is purely cosmetic: it doesn't change affection, or it'd be farmable.
  let persona = null;
  let URLS = {}; // mood -> image URL; a mood with no image uses the neutral one
  async function loadPersona(id) {
    const getJSON = async (path) => (await fetch(chrome.runtime.getURL(path))).json();
    const fetchPersona = (pid) => getJSON(`personas/${pid}/persona.json`).then((p) => [pid, p]);
    // No, unknown or broken id: fall back to the first persona in personas/index.json
    const [pid, p] = await (id ? fetchPersona(id) : Promise.reject())
      .catch(async () => fetchPersona((await getJSON("personas/index.json"))[0]));
    persona = p;
    // "pixelArt": false in persona.json = smooth illustration; crisp pixel scaling would make it jagged
    stage.classList.toggle("smooth", p.pixelArt === false);
    const img = (file) => file && chrome.runtime.getURL(`personas/${pid}/${file}`);
    URLS = Object.fromEntries(MOODS.map((m) => [m, img(p.images?.[m]) || img(p.images?.neutral)]));
    Object.values(URLS).forEach((u) => u && (new Image().src = u)); // preload so mood swaps don't flicker
    showSprite();
  }

  // Pixel font, bundled so it works on every site. Registered on the page, usable inside the shadow root.
  const font = new FontFace("Moe Pixel", `url(${chrome.runtime.getURL("fonts/Jersey10.ttf")})`);
  font.load().then((f) => document.fonts.add(f)).catch(() => {}); // falls back to monospace

  // Tiny pixel heart (7x6 grid), reused for the HUD and floating particles
  const heart = (fill) =>
    `<svg viewBox="0 0 7 6" shape-rendering="crispEdges"><path fill="#2b2135" d="M1 0h2v1h1V0h2v1h1v3H6v1H5v1H2V5H1V4H0V1h1z"/>` +
    `<path fill="${fill}" d="M1 1h2v1h1V1h2v2H5v1H4v1H3V4H2V3H1z"/><path fill="#fff" d="M1 1h1v1H1z"/></svg>`;

  // Shadow DOM: the page's CSS can't restyle the pet, and the pet's CSS can't leak into the page
  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { --ink:#2b2135; --paper:#fff8ef; --pink:#ff6b9d; --low:#8f7fa8; --high:#ff3d7f; --green:#2fa85f; --red:#e8434f; --empty:#eadff0; }
      * { box-sizing:border-box; }
      .pet { display:flex; flex-direction:column; align-items:flex-end; gap:10px;
             font:20px/1.1 "Moe Pixel", monospace; color:var(--ink); -webkit-font-smoothing:none; }
      /* Pixel-notched outline: four offset shadows leave the corners empty, plus a hard drop shadow */
      .px { background:var(--paper);
            box-shadow:0 -3px 0 var(--ink), 0 3px 0 var(--ink), -3px 0 0 var(--ink), 3px 0 0 var(--ink), 0 9px 0 rgba(43,33,53,.18); }

      .bubble { position:relative; min-width:72px; max-width:230px; padding:8px 10px; margin-bottom:6px; transform-origin:85% 100%; }
      .bubble.in { animation:pop .18s steps(3); }
      .bubble[hidden] { display:none; }
      .bubble::after { content:""; position:absolute; right:42px; bottom:-9px; width:15px; height:9px;
        background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 5 3' shape-rendering='crispEdges'%3E%3Cpath fill='%232b2135' d='M0 0h1v1h1v1h1V1h1V0h1v1H4v1H3v1H2V2H1V1H0z'/%3E%3Cpath fill='%23fff8ef' d='M1 0h3v1H3v1H2V1H1z'/%3E%3C/svg%3E") 0 0/100% 100%; }
      .text { margin:0; word-wrap:break-word; }
      .dots span { display:inline-block; animation:dot 1s steps(2) infinite; }
      .dots span:nth-child(2) { animation-delay:.15s } .dots span:nth-child(3) { animation-delay:.3s }
      .count { margin-top:6px; color:var(--red); }
      .keep { all:unset; display:block; margin-top:8px; padding:5px 8px; cursor:pointer; text-align:center;
              font:inherit; color:#fff; background:var(--red);
              box-shadow:0 -3px 0 var(--ink), 0 3px 0 var(--ink), -3px 0 0 var(--ink), 3px 0 0 var(--ink), inset 0 -3px 0 rgba(0,0,0,.2); }
      .keep:hover { filter:brightness(1.1) } .keep:active { transform:translateY(2px) }
      .keep[hidden], .count[hidden] { display:none; }

      .card { position:relative; padding:8px 8px 10px; display:flex; flex-direction:column; align-items:center; gap:6px; }
      .stage { position:relative; width:96px; height:96px; cursor:grab; touch-action:none; user-select:none; }
      .stage:active { cursor:grabbing; }
      /* contain: non-square art keeps its proportions instead of being stretched to the square stage */
      .sprite { width:100%; height:100%; object-fit:contain; image-rendering:pixelated; pointer-events:none; display:block; }
      .smooth .sprite { image-rendering:auto; }
      .fallback { display:none; font-size:22px; line-height:96px; text-align:center; width:100%; }
      .broken .sprite { display:none } .broken .fallback { display:block }
      .min { all:unset; position:absolute; top:4px; right:4px; width:15px; height:15px; cursor:pointer; opacity:0;
             font:16px/15px "Moe Pixel", monospace; text-align:center; color:var(--ink); background:var(--empty); }
      .card:hover .min { opacity:1 }

      .hud { display:flex; align-items:center; gap:5px; position:relative; }
      .hud svg { width:14px; height:12px; display:block; }
      .bar { display:flex; gap:2px; padding:2px; background:var(--ink); }
      .seg { width:5px; height:8px; background:var(--empty); }
      .num { font-size:16px; min-width:20px; color:#7a6d88; }
      .delta { position:absolute; right:0; bottom:100%; font-size:20px; white-space:nowrap; opacity:0;
               text-shadow:2px 0 var(--paper), -2px 0 var(--paper), 0 2px var(--paper), 0 -2px var(--paper); }
      .delta.show { animation:rise 1.6s steps(8) forwards; }

      .fx { position:absolute; inset:0; pointer-events:none; overflow:visible; }
      .particle { position:absolute; width:14px; height:12px; animation:float 1.2s steps(8) forwards; }
      .particle.drop { animation:drop 1.2s steps(8) forwards; }

      /* Minimized: just a small sprite, no bubble (unless a countdown needs you) or HUD */
      .pet.mini .stage { width:48px; height:48px; }
      .pet.mini .fallback { line-height:48px; font-size:16px; }
      .pet.mini .hud, .pet.mini .bubble:not(.urgent) { display:none; }
      .pet.mini .card { padding:4px; }

      /* Mood motion; steps() makes it move in discrete frames like real pixel animation */
      .stage .sprite, .stage .fallback { animation:bob 1.6s steps(2) infinite; }
      .pet[data-mood=happy] .sprite, .pet[data-mood=happy] .fallback { animation:hop 1.4s steps(6) infinite; }
      .pet[data-mood=sad] .sprite, .pet[data-mood=sad] .fallback { animation:droop 2.4s steps(2) infinite; }
      .pet[data-mood=angry] .sprite, .pet[data-mood=angry] .fallback { animation:shake .4s steps(4) 3, tremble .6s steps(2) 1.2s infinite; }
      .stage.popping { animation:pop .25s steps(3); }
      .stage.petted .sprite { animation:hop .5s steps(4); }

      @keyframes bob { 50% { transform:translateY(-3px) } }
      @keyframes hop { 0%,55%,100% { transform:translateY(0) } 70% { transform:translateY(-9px) } 85% { transform:translateY(-3px) } }
      @keyframes droop { 50% { transform:translateY(3px) scaleY(.96) } }
      @keyframes shake { 25% { transform:translateX(-4px) } 75% { transform:translateX(4px) } }
      @keyframes tremble { 50% { transform:translateX(1px) } }
      @keyframes pop { 0% { transform:scale(.6) } 60% { transform:scale(1.12) } 100% { transform:scale(1) } }
      @keyframes rise { 0% { opacity:1; transform:translateY(4px) } 70% { opacity:1 } 100% { opacity:0; transform:translateY(-14px) } }
      @keyframes float { 0% { opacity:1; transform:translateY(0) } 100% { opacity:0; transform:translateY(-48px) } }
      @keyframes drop { 0% { opacity:1; transform:translateY(0) rotate(0) } 100% { opacity:0; transform:translateY(30px) rotate(25deg) } }
      @keyframes dot { 50% { transform:translateY(-3px) } }
      @media (prefers-reduced-motion: reduce) { * { animation:none !important; } }
    </style>
    <div class="pet" data-mood="neutral">
      <div class="bubble px" hidden>
        <p class="text"></p>
        <div class="count" hidden></div>
        <button class="keep" hidden>I need this tab!</button>
      </div>
      <div class="card px">
        <button class="min" title="Minimize">–</button>
        <div class="stage" title="Drag to move, click to pet">
          <img class="sprite" alt="" draggable="false" />
          <span class="fallback"></span>
          <div class="fx"></div>
        </div>
        <div class="hud" title="Affection">
          ${heart("#ff6b9d")}
          <div class="bar">${'<div class="seg"></div>'.repeat(10)}</div>
          <span class="num"></span>
          <span class="delta"></span>
        </div>
      </div>
    </div>`;
  document.documentElement.appendChild(host);

  const $ = (sel) => root.querySelector(sel);
  const pet = $(".pet"), stage = $(".stage"), sprite = $(".sprite"), fallback = $(".fallback");
  const bubble = $(".bubble"), text = $(".text"), count = $(".count"), keep = $(".keep");
  const delta = $(".delta"), fx = $(".fx"), hud = $(".hud");
  const segs = [...root.querySelectorAll(".seg")];

  sprite.onload = () => stage.classList.remove("broken");
  // A mood image that's missing or fails to load falls back to neutral, then to the text face
  sprite.onerror = () => {
    if (URLS.neutral && sprite.src !== URLS.neutral) sprite.src = URLS.neutral;
    else stage.classList.add("broken");
  };

  // Restart a CSS animation by toggling its class (the reflow in between makes the browser replay it)
  function replay(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  let mood = null;
  function setMood(m) {
    const next = MOODS.includes(m) ? m : "neutral";
    if (next === mood) return;
    mood = next;
    pet.dataset.mood = mood;
    fallback.textContent = FACES[mood];
    showSprite();
    replay(stage, "popping");
  }
  function showSprite() {
    if (!mood || !URLS[mood]) return; // persona or mood not known yet; called again once both are
    stage.classList.remove("broken");
    sprite.src = URLS[mood];
  }

  // Each of the 10 segments is worth 10 points and fills partially, so 34 shows 3.4 segments, not a rounded 3
  function setAffection(a = 50) {
    const color = a >= 70 ? "var(--high)" : a >= 40 ? "var(--pink)" : "var(--low)";
    segs.forEach((s, i) => {
      const px = Math.round((Math.max(0, Math.min(10, a - i * 10)) / 10) * 5); // whole pixels, segments are 5px wide
      s.style.background = `linear-gradient(to right, ${color} ${px}px, var(--empty) ${px}px)`;
    });
    $(".num").textContent = a;
    hud.title = `Affection ${a}/100`;
  }

  function particles(kind, n) {
    for (let i = 0; i < n; i++) {
      const p = document.createElement("div");
      p.className = `particle ${kind === "down" ? "drop" : ""}`;
      p.innerHTML = heart(kind === "down" ? "#8f7fa8" : "#ff6b9d");
      p.style.left = `${20 + Math.random() * 50}px`;
      p.style.top = `${kind === "down" ? 30 : 10 + Math.random() * 20}px`;
      p.style.animationDelay = `${i * 0.15}s`;
      fx.append(p);
      setTimeout(() => p.remove(), 1600 + i * 150);
    }
  }

  // Floating "+3%" / "-15%" by the bar, plus hearts rising or a grey heart dropping
  function showDelta(d) {
    if (!d) return;
    delta.textContent = `${d > 0 ? "+" : ""}${d}%`;
    delta.style.color = d > 0 ? "var(--green)" : "var(--red)";
    replay(delta, "show");
    particles(d > 0 ? "up" : "down", d > 0 ? Math.min(3, Math.ceil(d / 3)) : 1);
  }

  // Speech bubble: auto-hides after a while, unless a countdown is running
  let hideTimer = null;
  function say(message, { thinking = false, sticky = false } = {}) {
    if (thinking) text.innerHTML = '<span class="dots"><span>•</span> <span>•</span> <span>•</span></span>';
    else text.textContent = message;
    bubble.hidden = false;
    replay(bubble, "in"); // re-trigger the pop-in
    clearTimeout(hideTimer);
    if (!sticky && !thinking) hideTimer = setTimeout(() => (bubble.hidden = true), 9000);
  }

  // --- Shared state across tabs: mood, affection, minimized, position ---
  chrome.storage.local.get(["pet", "petMin", "petPos", "dere"]).then(({ pet: p, petMin, petPos, dere }) => {
    loadPersona(dere);
    setMood(p?.mood);
    setAffection(p?.affection);
    pet.classList.toggle("mini", !!petMin);
    // Clamp: a position saved on a big monitor could be off-screen in a smaller window
    if (petPos) Object.assign(host.style, {
      right: `${Math.max(0, Math.min(petPos.right, innerWidth - host.offsetWidth))}px`,
      bottom: `${Math.max(0, Math.min(petPos.bottom, innerHeight - host.offsetHeight))}px`,
    });
  });
  chrome.storage.onChanged.addListener((changes) => {
    const p = changes.pet?.newValue;
    if (p) {
      setMood(p.mood);
      setAffection(p.affection);
      showDelta(p.affection - (changes.pet.oldValue?.affection ?? p.affection));
    }
    if (changes.petMin) pet.classList.toggle("mini", !!changes.petMin.newValue);
    if (changes.dere) loadPersona(changes.dere.newValue); // picked a different persona in the popup
  });

  $(".min").onclick = () => chrome.storage.local.set({ petMin: !pet.classList.contains("mini") });

  // --- Drag to move; a click without movement pets her instead ---
  let drag = null;
  stage.addEventListener("pointerdown", (e) => {
    stage.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, right: parseInt(host.style.right), bottom: parseInt(host.style.bottom), moved: false };
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return; // tiny wobble = still a click
    drag.moved = true;
    const maxR = innerWidth - host.offsetWidth, maxB = innerHeight - host.offsetHeight;
    host.style.right = `${Math.max(0, Math.min(maxR, drag.right - dx))}px`;
    host.style.bottom = `${Math.max(0, Math.min(maxB, drag.bottom - dy))}px`;
  });
  stage.addEventListener("pointercancel", () => (drag = null)); // browser took over the gesture: stop following
  stage.addEventListener("pointerup", async () => {
    if (!drag) return;
    const { moved } = drag;
    drag = null;
    if (moved) {
      chrome.storage.local.set({ petPos: { right: parseInt(host.style.right), bottom: parseInt(host.style.bottom) } });
      return;
    }
    // Petting
    const lines = persona?.petLines?.length ? persona.petLines : ["♥"];
    replay(stage, "petted");
    setTimeout(() => stage.classList.remove("petted"), 500); // hand the sprite back to its mood animation
    particles("up", 2);
    if (!countdown) say(lines[Math.floor(Math.random() * lines.length)]);
  });

  // --- Verdicts from the background script ---
  let countdown = null;
  // "I need this tab!" spares that one page (that video), not the whole tab: YouTube swaps videos without
  // reloading, so sparing the tab would spare every video you click next. Ignores #hash and YouTube's &t= timestamp.
  let sparedUrl = null;
  const pageKey = (url) => {
    const u = new URL(url);
    u.hash = "";
    u.searchParams.delete("t");
    return u.href;
  };
  function clearCountdown() {
    clearInterval(countdown);
    countdown = null;
    count.hidden = keep.hidden = true;
    bubble.classList.remove("urgent");
  }

  chrome.runtime.onMessage.addListener((m) => {
    // "say" = status text only ("thinking", errors); the mood stays as it was
    if (m.type === "say") {
      if (!countdown) say(m.message, { thinking: m.thinking });
      return;
    }
    if (m.type !== "verdict") return;
    setMood(m.mood);
    // Still off task with a countdown already running (e.g. scrolling Shorts): keep counting down.
    // Restarting it on every new verdict would mean the tab never actually closes.
    if (m.willClose && countdown) {
      say(m.message || "", { sticky: true });
      return;
    }
    if (m.willClose && sparedUrl && m.url && pageKey(m.url) === sparedUrl) {
      say(m.message || "");
      return;
    }
    clearCountdown();
    say(m.message || "", { sticky: m.willClose });

    if (m.willClose) {
      let n = m.countdownSec || 10;
      bubble.classList.add("urgent"); // stays visible even when minimized
      count.hidden = keep.hidden = false;
      count.textContent = `Closing this tab in ${n}...`;
      keep.onclick = () => {
        clearCountdown();
        sparedUrl = pageKey(m.url || location.href);
        say("...fine. Don't make me regret this.");
      };
      countdown = setInterval(() => {
        n--;
        count.textContent = `Closing this tab in ${n}...`;
        if (n <= 0) {
          clearCountdown();
          chrome.runtime.sendMessage({ type: "closeMe" });
        }
      }, 1000);
    }
  });
})();
