# Moegotchi

**A digital sidekick that lives in your browser and kicks you back to work.**

Built for **Fall Hacks 26** (theme: *Digital Side-kick*) by Keith Setiadharma.

<!-- TODO: add a screenshot or GIF here, then uncomment the line below. A 10s GIF of the pet reacting to a lecture tab vs a distraction tab is the best thing you can put in this README.
![Moegotchi demo](docs/demo.gif)
-->

## What it is

Everyone gets distracted. Website blockers don't help much: they block YouTube even when you're watching a lecture, and they're easy to ignore.

Moegotchi is a Chrome extension with a pixel-art sidekick that understands *what you're actually doing*. You tell it your task, pick a personality, and it watches your tabs. Gemini decides whether the page helps with your task, and your sidekick reacts in character: it cheers when you're locked in, and it gets sad, annoyed, or gets rid of the tab when you drift.

Different people respond to different kinds of motivation, so you choose the kind of push that works on you.

## Features

- **Context-aware judging.** A lecture on your topic and an unrelated video on the same site get different verdicts.
- **Ten sidekicks,** each with its own voice, all generated live by Gemini (not scripted lines):
  - **Campus mascots:** Jepi, a helpful little Raspberry Pi (CSSS), and the SURGE otters Stormy, Sparky, Trendy and Spendy
  - **Tsun,** an aloof cat who pretends not to care, and closes distracting tabs after a countdown
  - **Sarge,** a tough-but-fair drill sergeant who closes tabs even faster
  - **Zippy,** pure hype; **Pebble,** calm and gentle for people stressed by pushy pets; **Meh,** deadpan and quietly disappointed
- **Affection system.** Your sidekick's mood and tone change with how you've been behaving. Getting caught costs affection, every further distraction (each Short, each video) costs more, and coming back to work earns it back. Time only counts while you're actually at Chrome: it pauses when you're idle, locked, or in another app. Lines are written for the *current* affection level.
- **Fair warnings.** Strict sidekicks show a countdown with an "I need this tab!" button before closing anything. That spares the one video you needed, not the whole tab. Closed tabs can be restored in one click from the popup.
- **Benefit of the doubt.** A blank Google Doc or an unclear page counts as work. Your sidekick would rather miss a slack-off than scold you mid-essay, and only closes a tab when Gemini is sure it's a distraction.
- **Evidence escalation.** For unclear pages, it gathers more context instead of guessing (see below).
- **End-of-session recap.** Press "End session" and Gemini writes an in-character summary from stats computed in code.
- **Pixel-art UI.** Animated sprites and speech bubbles that live in a shadow DOM, so they don't clash with the page's styles.

## How Gemini is used

Gemini is the core of the product, not an add-on.

1. **Cheapest evidence first.** The extension checks a cache first. On a miss it sends the tab title, URL and the page's short description (plus the channel name on YouTube). On YouTube and Vimeo, where a title can't tell a lecture from entertainment, it also sends a small **screenshot** (multimodal input). On any other site, if Gemini says it isn't sure, it takes a second look with the page's headings. This keeps most calls fast and cheap.
2. **Structured output.** Gemini returns JSON (`on_task`, a confidence value, and four lines written for the current affection level), so the UI can use the response directly with no text parsing.
3. **Personality from the model.** Each sidekick is a different system prompt, kept in its own `personas/<id>/persona.json`. The same distraction gets a different reaction depending on whom you picked, and on how the session has gone so far.
4. **Two models for two jobs.** A fast Flash-Lite model handles the frequent on/off-task judgments, and a stronger Flash model writes the end-of-session recap.
5. **Game logic stays in code.** Affection and stats are computed deterministically, and Gemini only writes the words. That keeps the behavior predictable.

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

The free Gemini tier has a small daily request limit. To work on the UI without spending quota, set `MOCK = true` in `background.js`. In mock mode no API calls are made and verdicts come from simple rules. Set it back to `false` to use real Gemini judging.

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

### Adding a sidekick

No code changes needed: create `personas/<id>/` with a `persona.json` and mood images (`happy`, `neutral`, `sad`, `angry`; only `neutral` is required, missing moods fall back to it), add the id to `personas/index.json`, and reload the extension. Copy an existing `persona.json` as a template.

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

- Official art for the SURGE otters, and more sidekicks and customization
- To-do lists using Gemini function calling
- Chatting with your sidekick
- Pet evolution and unlockables

## Built with

JavaScript, HTML, CSS, Chrome Extension (Manifest V3), Gemini API, SVG pixel art.