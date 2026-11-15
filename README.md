# Before You Hit Send

Paste an email, text or comment and an AI model checks it for **rude, insulting, profane, threatening or hateful language** before you send it, sentence by sentence. **The model runs entirely in the browser**: nothing you type leaves your device.

Ryan Lacerna · CAI2300C (Dr. Lee) · "Build an AI model that runs in the browser"

- Live: https://before-you-hit-send.netlify.app
- Offline: unzip `Before-You-Hit-Send.zip` and double-click `index.html`

## How it works

| Part | Details |
|---|---|
| Model | [`Xenova/toxic-bert`](https://huggingface.co/Xenova/toxic-bert): Unitary's BERT model fine-tuned on the Jigsaw Toxic Comment dataset (about 160,000 Wikipedia comments labeled by people), converted to ONNX and quantized to 8-bit (about 110 MB). Multi-label: toxic, severe toxic, obscene, threat, insult, identity hate. |
| Runtime | [transformers.js](https://huggingface.co/docs/transformers.js) 3.7.6 (ONNX Runtime Web, WebAssembly). `env.allowRemoteModels = false`, so it never calls Hugging Face. |
| Checks | The whole message gets six scores, then each sentence is scored on its own so the app can highlight exactly which line to rewrite. |
| Verdict | Every score under 30%: looks good to send. 30–70%: might come across badly. 70% or more: don't send as written. |

## Files

- `site/index.html`, `site/app.js`: the page and the app logic
- `scripts/netlify-build.sh`: Netlify build step that copies the runtime from npm into `site/lib` and downloads the model into `site/models` (the model is too big for a GitHub web upload)
- `scripts/build_offline.py`: builds the double-click folder (`index.html` + `files/`). Browsers block `fetch()` for pages opened from the file system, so the model and runtime are stored as `.js` files and handed to transformers.js from memory.

Run locally:

```bash
npm install
bash scripts/netlify-build.sh
python3 -m http.server -d site
```

## Limits

- It flags harmful language, not tone in general: polite but cold or passive-aggressive messages ("Per my last email…") usually pass.
- Friendly swearing ("that was damn good") can be flagged.
- English only. The training data is Wikipedia talk-page comments, so very new slang may be missed.
