# Moegotchi

### Blockers block sites. Moegotchi understands them.

A Chrome extension where a pixel-art sidekick watches what you're actually doing, uses Gemini to judge whether it helps your task, and reacts in a personality *you* picked: cheering you on, roasting you, or quietly closing the tab that's eating your night.

Built for **Fall Hacks 26** (theme: *Digital Side-kick*) by Keith Setiadharma.

<!-- TODO: add a 10-15s GIF: set a task, open a lecture (happy), open an unrelated video on the SAME site (angry), tab closes after the countdown. Then uncomment the next line. -->
<!-- ![Moegotchi demo](docs/demo.gif) -->

---

## The problem with focus tools

Every focus tool is a blocklist. That makes them dumb in two ways:

- They block YouTube even when you're watching a lecture for your class.
- They don't care that *you* are the problem: some people need a cheerleader, some need a drill sergeant, and a grey "this site is blocked" page motivates nobody.

## What Moegotchi does differently

| | Typical blocker | Moegotchi |
| --- | --- | --- |
| Decides by | A list of sites | What the page is actually about, relative to **your task** |
| Same site, different page | Same verdict | Lecture = on task, unrelated video = off task |
| Tone | One cold message | **10 sidekicks**, each with its own voice, written live by Gemini |
| When unsure | Blocks anyway | **Benefit of the doubt.** Never scolds you on a blank doc or unclear page |
| After a slip | Nothing | Affection changes, tone shifts, and getting back on track earns it back |
| End of day | Nothing | In-character recap of how your session really went |

## Try it in 60 seconds

1. Set your task to something like *"study binary search trees"* and pick a sidekick.
2. Open a Wikipedia page on the topic. Your sidekick is happy.
3. Open an unrelated video **on YouTube**. Same site, different verdict. Your sidekick calls you out.
4. Keep scrolling. With a strict sidekick (Tsun or Sarge), a countdown starts, with an "I need this tab!" button as your escape hatch.
5. Press **End session** for a recap written in your sidekick's voice.

---

## How Gemini is used

Gemini is the product, not a feature bolted onto it. Take it out and there is nothing left but a cat sprite.

| Gemini capability | What it does here |
| --- | --- |
| **Multimodal input** | On YouTube and Vimeo, where a title can't tell a lecture from entertainment, it sends a small screenshot of the page |
| **Structured output** | Returns JSON (`on_task`, a confidence value, and four lines written for the current mood), so the UI uses the reply directly |
| **Persona via system prompt** | Each sidekick is its own `persona.json` voice prompt. The same distraction produces a different reaction per sidekick, and per affection level |
| **Model routing** | A fast Flash-Lite model does the frequent judgments, and a stronger Flash model writes the end-of-session recap |
| **Escalating evidence** | Cheapest context first: cache, then title/URL/description, then a screenshot (YouTube/Vimeo), then page headings for a second look if the model says it isn't sure |

Gemini writes the words. **The game logic is plain code.** Affection, stats, and countdowns are computed deterministically, so behavior stays predictable and a flaky response can't break the experience.

## Design choices we're proud of

- **It would rather miss a slip than scold you wrongly.** An unclear page counts as work, and a tab only closes when the model is *sure* it's a distraction. False alarms are what make people uninstall focus tools.
- **Fair, not tyrannical.** Strict sidekicks always give a countdown first, and "I need this tab!" spares just that one video. Closed tabs restore in one click.
- **Every extra distraction costs more.** Each Short or video drains affection, so doomscrolling is felt in the character and not only in a timer. Time only counts while you're actually in Chrome, so it pauses when you're idle, locked, or in another app.
- **Cost-aware by design.** A cache and an escalation ladder keep most checks cheap, so it works on a free API key (we built it against a 20-requests-a-day free tier, which forced the design).
- **Personas are data, not code.** Adding a sidekick is a folder, with no code changes (see below).

## The sidekicks

Ten, each with its own voice and strictness:

- **Campus mascots:** Jepi, a helpful little Raspberry Pi (CSSS), and the SURGE otters Stormy, Sparky, Trendy and Spendy, used with the organizers' permission
- **Tsun,** an aloof cat who pretends not to care, and closes distracting tabs after a countdown
- **Sarge,** a tough-but-fair drill sergeant who closes tabs fast
- **Zippy,** pure hype
- **Pebble,** calm and gentle, for people stressed by pushy pets
- **Meh,** deadpan and quietly disappointed

### Adding a sidekick

No code changes. Create `personas/<id>/` with a `persona.json` and mood images (`happy`, `neutral`, `sad`, `angry`; only `neutral` is required and missing moods fall back to it), add the id to `personas/index.json`, and reload the extension. Copy an existing `persona.json` as a template.

---

## Install and run

1. Get a free Gemini API key at [Google AI Studio](https://aistudio.google.com).
2. Clone this repo:
   ```bash
   git clone https://github.com/keithsetiadharma/moegotchi.git
   ```
3. Open `chrome://extensions` and turn on **Developer mode**.
4. Click **Load unpacked** and select the `moegotchi` folder.
5. In the extension's details, set **Site access → On all sites** so your sidekick can appear everywhere.
6. Click the Moegotchi icon, then enter your **task**, pick a **sidekick**, paste your **API key**, and start.

The API key is stored locally in `chrome.storage.local`. It is never written into the code or the repo.

### Mock mode (for development)

The free Gemini tier has a small daily request limit. To work on the UI without spending quota, set `MOCK = true` in `background.js`. No API calls are made and verdicts come from simple rules. Set it back to `false` for real Gemini judging.

## How it works

```
 tab change / page settles
          |
          v
   background.js  --(cache hit)--> reuse verdict
          |
          | cache miss: gather evidence
          |   title + URL + page description
          |   + screenshot (YouTube/Vimeo only)
          |   + headings (second look, if Gemini is unsure)
          v
      Gemini API  --> JSON: on_task, confidence, 4 in-character lines
          |
          v
   update affection in code, save to storage
          |
          v
   content.js (every tab): animate sprite + speech bubble
```

| File | Role |
| --- | --- |
| `manifest.json` | Manifest V3 config and permissions |
| `background.js` | Watches tabs, calls Gemini, tracks affection, closes tabs |
| `content.js` | The sidekick UI, injected into every page (shadow DOM) |
| `popup.html` / `popup.js` | Setup, session controls, restore closed tabs |
| `personas/` | One folder per sidekick: `persona.json` (voice, lines, settings) plus mood images; `index.json` lists them |
| `fonts/` | Jersey 10 pixel font (OFL license) |
| `tools/make_sprites.py` | Generates the pixel-art sprites |

## Privacy

Moegotchi has to look at what you browse in order to work, so here is exactly what leaves your machine:

- **Tab title, URL and the page's short description** of the page you're on are sent to the Gemini API.
- **Page headings** are sent only when Gemini isn't sure from the above.
- **Screenshots** are only ever taken on an allowlist: YouTube and Vimeo. No other site, including email or banking, is ever sent as an image.
- Your API key and settings stay in local browser storage.
- Data sent to the Gemini API is subject to Google's terms for the API tier you use.

You can turn the extension off at any time from `chrome://extensions`.

## Known limitations

- The verdict cache resets when the extension's background worker goes to sleep.
- Tab titles and URLs go to Gemini for every page you visit (only screenshots are restricted).
- A page title written to fool the model could sway a verdict (prompt injection).
- Chrome only. Firefox-based browsers would need manifest changes.
- It's a hackathon project, so expect rough edges.

## What's next

- Official art for every mascot, plus more sidekicks and customization
- To-do lists using Gemini function calling
- Chatting with your sidekick
- Pet evolution and unlockables

## Built with

JavaScript, HTML, CSS, Chrome Extension (Manifest V3), Gemini API, SVG pixel art.