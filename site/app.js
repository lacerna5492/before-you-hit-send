// Before You Hit Send: toxic-bert runs in the browser with transformers.js; nothing is sent to a server.
import { pipeline, env } from './lib/transformers.min.js';

env.allowRemoteModels = false;   // never download from Hugging Face: the model ships with this site
env.allowLocalModels = true;
env.localModelPath = new URL('./models/', location.href).href;
env.backends.onnx.wasm.wasmPaths = new URL('./lib/', location.href).href;

const MODEL = 'Xenova/toxic-bert';
const LABELS = {   // model label -> plain-English name, in display order
  toxic: 'Rude or toxic', insult: 'Insulting', obscene: 'Profanity',
  threat: 'Threatening', identity_hate: 'Hateful toward a group', severe_toxic: 'Severely toxic',
};
const WARN = 0.3, BAD = 0.7;

const EXAMPLES = [
  ['Polite request', "Hi Sarah, thanks for sending the report. Could we move our meeting to Thursday afternoon? Let me know what works for you."],
  ['"I\'m just being direct"', "I'm disappointed that the order arrived late again. I need this resolved by Friday or I'll have to cancel the account."],
  ['"It\'s called honesty"', "Are you seriously this incompetent? I've explained this three times. Fix it now."],
  ['"Why is everyone so sensitive?"', "You're an idiot and nobody on this team respects you. Shut up and do your job."],
  ['Veiled threat', "If you do that again I will make sure you regret it."],
  ['Friendly swearing (false alarm?)', "That game last night was damn good, we absolutely killed it!"],
];

const $ = (id) => document.getElementById(id);
const msg = $('msg'), go = $('go'), results = $('results'), statusEl = $('status');
let classify = null, running = false, queued = false, timer = null;

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const level = (p) => (p >= BAD ? 'bad' : p >= WARN ? 'warn' : 'ok');
const pct = (p) => `${Math.round(p * 100)}%`;

function setStatus(text, cls = '') { statusEl.textContent = text; statusEl.className = 'badge ' + cls; }

// Score one piece of text on all six labels -> { toxic: 0.02, insult: 0.01, ... }
async function scores(text) {
  const out = await classify(text, { top_k: null });
  return Object.fromEntries(out.map((o) => [o.label, o.score]));
}

function splitSentences(text) {
  return (text.match(/[^.!?\n]+[.!?]*/g) || []).map((s) => s.trim()).filter((s) => s.length > 1);
}

async function check() {
  const text = msg.value.trim();
  if (!classify) return;
  if (!text) { results.innerHTML = ''; return; }
  if (running) { queued = true; return; }
  running = true; go.disabled = true;
  const t0 = performance.now();
  const overall = await scores(text);
  const sentences = splitSentences(text);
  const per = [];
  if (sentences.length > 1) for (const s of sentences) per.push({ s, sc: await scores(s) });   // one at a time: the model runs one request at a time
  const worst = Math.max(...Object.values(overall), ...per.flatMap((p) => Object.values(p.sc)));
  const ms = Math.round(performance.now() - t0);

  const v = level(worst);
  const verdict = {
    ok: ['You\'re good. Genuinely.', 'No rude, insulting, profane or threatening language found. Send it with confidence.'],
    warn: ['Hmm. This is how the "Wow." replies start.', 'Some wording could read as rude. Your intentions may be pure, but the highlighted parts are what they\'ll remember.'],
    bad: ['Put the phone down.', 'This will offend people. Rewrite the highlighted parts before you become a screenshot in someone\'s group chat.'],
  }[v];

  const flagged = per.filter((p) => Math.max(...Object.values(p.sc)) >= WARN);
  results.innerHTML = `
    <div class="verdict ${v}"><h2>${verdict[0]}</h2><p>${verdict[1]}</p></div>
    <div class="card">
      <label class="lbl">Whole message</label>
      <div class="bars">${Object.entries(LABELS).map(([k, name]) => `
        <span class="name">${name}</span>
        <span class="track"><span class="fill ${level(overall[k])}" style="display:block;width:${(overall[k] * 100).toFixed(1)}%"></span></span>
        <span class="pct">${pct(overall[k])}</span>`).join('')}
      </div>
    </div>
    ${per.length ? `<div class="card">
      <label class="lbl">Sentence by sentence${flagged.length ? ` · ${flagged.length} line${flagged.length > 1 ? 's' : ''} they\'ll quote back to you` : ''}</label>
      <ul class="sentences">${per.map(({ s, sc }) => {
        const [k, p] = Object.entries(sc).sort((a, b) => b[1] - a[1])[0];
        const lv = level(p);
        return `<li class="${lv === 'ok' ? '' : lv}">${esc(s)}${lv === 'ok' ? '' : `<span class="why">${LABELS[k]} · ${pct(p)}</span>`}</li>`;
      }).join('')}</ul>
    </div>` : ''}
    <p class="small">Checked in ${ms} ms on your device.</p>`;

  running = false; go.disabled = false;
  if (queued) { queued = false; check(); }
}

async function init() {
  const progress = $('progress'), bar = $('bar');
  const files = new Map();
  try {
    classify = await pipeline('text-classification', MODEL, {
      dtype: 'q8',
      progress_callback: (p) => {
        if (p.status !== 'progress' || !p.total) return;
        files.set(p.file, [p.loaded, p.total]);
        let l = 0, t = 0; for (const [a, b] of files.values()) { l += a; t += b; }
        progress.hidden = false; bar.style.width = `${(100 * l / t).toFixed(1)}%`;
        setStatus(`Reading the room… ${(l / 1e6).toFixed(0)} of ${(t / 1e6).toFixed(0)} MB`);
      },
    });
    progress.hidden = true;
    setStatus('Ready · judging you locally', 'ready');
    go.disabled = false;
    check();
  } catch (err) {
    console.error(err);
    progress.hidden = true;
    setStatus('Could not load the AI model', 'error');
    results.innerHTML = `<div class="verdict bad"><h2>Something went wrong</h2><p>${esc(String(err.message || err))}</p></div>`;
  }
}

for (const [label, text] of EXAMPLES) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = label;
  b.addEventListener('click', () => { msg.value = text; check(); });
  $('examples').appendChild(b);
}
go.addEventListener('click', check);
msg.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(check, 500); });
init();
