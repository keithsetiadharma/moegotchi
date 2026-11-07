# Moegotchi

A Chrome extension pet that keeps you on task. Pick your dere (genki, tsundere, yandere, kuudere) and Gemini judges whether your current tab fits your task.

## Run it
1. Get a Gemini API key at https://aistudio.google.com
2. `chrome://extensions` -> Developer mode -> Load unpacked -> select this folder
3. Click the extension icon, enter your task, pick a dere, paste your key, Start.

The API key is stored in `chrome.storage.local`, never in the code, so it can't leak into the repo.
