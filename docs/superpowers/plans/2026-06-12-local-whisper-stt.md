# Local Whisper Speech-to-Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the buggy, Chrome-only Web Speech API in the Voice capture mode with an accurate, fully in-browser Whisper model that works offline with no API key.

**Architecture:** A module Web Worker (`whisperWorker.js`) runs transformers.js Whisper off the main thread. A classic-script controller (`whisperSTT.js`) records mic audio, resamples it to 16 kHz mono, and exchanges messages with the worker. `capture.js` is rewired to drive the controller against the existing Voice DOM; the old `SpeechRecognition` code is deleted. Record → transcribe-once, which structurally eliminates the interim-accumulation repetition bug.

**Tech Stack:** Vanilla JS (no build), `@huggingface/transformers@4.2.0` (transformers.js, WebGPU→WASM), Web Audio API, MediaRecorder, Web Worker (ESM). Tests run in-browser, driven by Playwright (MCP).

**Spec:** `docs/superpowers/specs/2026-06-12-local-whisper-stt-design.md`

**Verified facts (do not re-guess):**
- ESM bundle URL — use the **self-contained** browser build `dist/transformers.js` (NOT `dist/transformers.web.js`, which has unresolved bare imports like `onnxruntime-web` and cannot load in a module worker without a bundler): `https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.js` (HTTP 200, CORS `*`, `application/javascript`, exports `pipeline`/`env`, 0 bare imports). Confirmed loadable + transcribing in a module worker on 2026-06-12.
- Model ids: `Xenova/whisper-tiny.en`, `Xenova/whisper-base.en`, `Xenova/whisper-small.en`
- Test sample (302 → follows to CDN): `https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav`

---

## File Structure

| File | Responsibility |
|---|---|
| `js/whisperWorker.js` | **New.** Module worker. The ONLY file that imports transformers.js. Loads/caches model, transcribes 16 kHz Float32 audio, posts text back. No DOM. |
| `js/whisperSTT.js` | **New.** Classic-script controller. Mic capture (MediaRecorder), decode+resample to 16 kHz mono, worker messaging, public API + callbacks. No ML, no app deps. |
| `js/capture.js` | **Modify.** Rewrite `_initVoice`; delete `_startRecording`/`_stopRecording`/`SpeechRecognition` code + `_recognition`/`_isRecording`/`_voiceTranscript` state. |
| `index.html` | **Modify.** Add `<script src="js/whisperSTT.js">` before `capture.js`; add Voice-model `<select>` to the Settings modal. |
| `js/settings.js` | **Modify.** Persist/restore `sttModel`; push changes to `WhisperSTT.setModel`. |
| `css/style.css` | **Modify.** Small progress/`Transcribing…` state styles. |
| `tests/stt-tests.html` | **New.** In-browser test harness (resample unit test + transcription integration test). |

> **Note on git:** This project is not currently a git repository. Task 0 optionally initializes one so the per-task commit checkpoints work. If you skip Task 0, also skip every `git commit` step — the rest of the plan is unaffected.

---

## Task 0: Workspace prep (optional git + server)

**Files:** none (environment only)

- [ ] **Step 1: Confirm the local server is running**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8753/index.html`
Expected: `200`. If not, start it: `cd "/Users/haribazri/Desktop/memory of work" && (python3 -m http.server 8753 >/tmp/nm.log 2>&1 &)`

- [ ] **Step 2: (Optional) Initialize git for checkpointing**

```bash
cd "/Users/haribazri/Desktop/memory of work"
git init && printf '.DS_Store\n.playwright-mcp/\ntests/.cache/\n' > .gitignore
git add -A && git commit -m "chore: snapshot before local-whisper STT work"
```
Expected: a first commit. If you skip this, skip all later commit steps.

---

## Task 1: Test harness + failing resample test (RED)

**Files:**
- Create: `tests/stt-tests.html`

This test exists before the implementation so we get a genuine red. `WhisperSTT` is undefined until Task 2, so the resample test must fail.

- [ ] **Step 1: Create the test harness with the resample test**

Create `tests/stt-tests.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>STT Tests</title></head>
<body>
<h1>STT Tests</h1>
<pre id="out">Open the console or call window.runResampleTest() / window.runTranscribeTest().</pre>

<!-- Controller under test. Path is relative to THIS page. -->
<script src="../js/whisperSTT.js"></script>

<script>
function log(msg) {
  document.getElementById('out').textContent += '\n' + msg;
  console.log(msg);
}

// ── Unit test: resample any AudioBuffer to 16 kHz mono ──
window.runResampleTest = async () => {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const srcRate = 44100, dur = 0.5;                 // 0.5s @ 44.1kHz
  const buf = ctx.createBuffer(1, Math.floor(srcRate * dur), srcRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.sin(2 * Math.PI * 440 * i / srcRate);

  const out = await WhisperSTT._resampleToMono16k(buf);
  const expectedLen = 16000 * dur;                  // 8000 samples
  const ok = (out instanceof Float32Array)
    && Math.abs(out.length - expectedLen) <= 4      // allow tiny rounding
    && out.some(v => v !== 0);                       // not silent
  const result = { passed: ok, length: out.length, expected: expectedLen };
  log('runResampleTest → ' + JSON.stringify(result));
  ctx.close();
  return result;
};
</script>
</body>
</html>
```

- [ ] **Step 2: Run it and verify it FAILS**

Using Playwright (MCP): navigate to `http://localhost:8753/tests/stt-tests.html`, then evaluate `await window.runResampleTest()`.
Expected: **error** — `WhisperSTT is not defined` (file doesn't exist yet). This is the red.

- [ ] **Step 3: Commit**

```bash
git add tests/stt-tests.html && git commit -m "test: add failing resample unit test"
```

---

## Task 2: STT controller `whisperSTT.js` (make resample test GREEN)

**Files:**
- Create: `js/whisperSTT.js`

- [ ] **Step 1: Create the controller**

Create `js/whisperSTT.js`:

```js
/* ============================================================
   whisperSTT.js — mic capture + Whisper worker controller.
   Public API: init, toggle, setModel, isAvailable.
   Callbacks:  onStatus(state), onProgress(pct), onResult(text), onError(code).
   No ML here, no app dependencies.
   ============================================================ */
const WhisperSTT = (() => {
  // Resolve the worker URL relative to THIS script (not the page),
  // so it works from index.html (root) and tests/ alike.
  const _scriptUrl = (document.currentScript && document.currentScript.src) || location.href;
  const _workerUrl = new URL('whisperWorker.js', _scriptUrl).href;

  let _worker = null, _ready = false, _loading = false;
  let _model = 'whisper-base.en';
  let _recorder = null, _stream = null, _chunks = [], _recording = false;
  const _cb = { onStatus(){}, onProgress(){}, onResult(){}, onError(){} };

  function isAvailable() {
    return typeof Worker !== 'undefined'
      && typeof MediaRecorder !== 'undefined'
      && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
      && typeof WebAssembly !== 'undefined';
  }

  function init(opts = {}) {
    Object.assign(_cb, opts.callbacks || {});
    if (opts.model) _model = opts.model;
    if (!isAvailable()) { _cb.onError('unavailable'); return; }
    _worker = new Worker(_workerUrl, { type: 'module' });
    _worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress')   _cb.onProgress(m.pct);
      else if (m.type === 'ready') { _ready = true; _loading = false; _cb.onStatus('ready'); }
      else if (m.type === 'result'){ _cb.onResult(m.text); }
      else if (m.type === 'error') { _loading = false; _cb.onError(m.message); }
    };
    _worker.onerror = (err) => { _cb.onError('worker:' + (err.message || 'load failed')); };
  }

  function _ensureLoaded() {
    if (_ready || _loading || !_worker) return;
    _loading = true;
    _cb.onStatus('loading');
    _worker.postMessage({ type: 'load', model: _model });
  }

  function setModel(model) {
    if (!model || model === _model) return;
    _model = model;
    _ready = false;            // force reload on next use
  }

  async function toggle() { return _recording ? _stop() : _start(); }

  async function _start() {
    _ensureLoaded();
    try {
      _stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (_) { _cb.onError('mic-denied'); return; }
    _chunks = [];
    _recorder = new MediaRecorder(_stream);
    _recorder.ondataavailable = (e) => { if (e.data && e.data.size) _chunks.push(e.data); };
    _recorder.onstop = _onStop;
    _recorder.start();
    _recording = true;
    _cb.onStatus('recording');
  }

  function _stop() {
    if (!_recorder) return;
    _recording = false;
    _recorder.stop();
    if (_stream) _stream.getTracks().forEach(t => t.stop());
    _cb.onStatus('transcribing');
  }

  async function _onStop() {
    try {
      const blob = new Blob(_chunks, { type: (_recorder && _recorder.mimeType) || 'audio/webm' });
      const audio = await _decodeToMono16k(blob);
      if (!audio || audio.length < 1600) { _cb.onStatus('ready'); _cb.onError('too-short'); return; }
      _worker.postMessage({ type: 'transcribe', audio }, [audio.buffer]);
    } catch (err) {
      _cb.onStatus('ready');
      _cb.onError(String((err && err.message) || err));
    }
  }

  // Decode a recorded blob → 16 kHz mono Float32Array.
  async function _decodeToMono16k(blob) {
    const arrayBuf = await blob.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    const tmp = new AC();
    const decoded = await tmp.decodeAudioData(arrayBuf);
    tmp.close();
    return _resampleToMono16k(decoded);
  }

  // Resample an AudioBuffer → 16 kHz mono Float32Array via OfflineAudioContext.
  async function _resampleToMono16k(audioBuffer) {
    const targetRate = 16000;
    const frames = Math.ceil(audioBuffer.duration * targetRate);
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new OAC(1, frames, targetRate);
    const src = off.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(off.destination);
    src.start(0);
    const rendered = await off.startRendering();
    return rendered.getChannelData(0).slice();      // own its ArrayBuffer (transferable)
  }

  // Test hook: transcribe a raw 16 kHz mono Float32Array, resolve with text.
  function _transcribeForTest(float32) {
    return new Promise((resolve, reject) => {
      const prevR = _cb.onResult, prevE = _cb.onError;
      _cb.onResult = (t) => { _cb.onResult = prevR; _cb.onError = prevE; resolve(t); };
      _cb.onError  = (m) => { _cb.onResult = prevR; _cb.onError = prevE; reject(new Error(m)); };
      const copy = float32.slice();
      _ensureLoaded();
      (function send() {
        if (_ready) _worker.postMessage({ type: 'transcribe', audio: copy }, [copy.buffer]);
        else setTimeout(send, 100);
      })();
    });
  }

  return { init, toggle, setModel, isAvailable, _resampleToMono16k, _transcribeForTest };
})();
```

- [ ] **Step 2: Run the resample test and verify it PASSES**

Playwright: navigate to `http://localhost:8753/tests/stt-tests.html`, evaluate `await window.runResampleTest()`.
Expected: `{ "passed": true, "length": 8000, "expected": 8000 }` (length may be 8000±4).

- [ ] **Step 3: Commit**

```bash
git add js/whisperSTT.js && git commit -m "feat: add Whisper STT controller; resample test passes"
```

---

## Task 3: Whisper worker + transcription integration test

**Files:**
- Create: `js/whisperWorker.js`
- Modify: `tests/stt-tests.html` (add transcription test)

- [ ] **Step 1: Create the worker**

Create `js/whisperWorker.js`:

```js
// whisperWorker.js — runs transformers.js Whisper off the main thread (ESM module worker).
// Use dist/transformers.js (self-contained browser ESM), NOT dist/transformers.web.js.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.js';

env.allowLocalModels = false;     // fetch from HF Hub
env.useBrowserCache  = true;      // cache model in browser → offline after first load

let transcriber = null;
let currentModel = null;

function onProgress(p) {
  // p.status: 'initiate'|'download'|'progress'|'done'|'ready'; p.progress is 0..100
  if (p && p.status === 'progress') {
    const pct = typeof p.progress === 'number'
      ? Math.round(p.progress)
      : (p.total ? Math.round((p.loaded / p.total) * 100) : 0);
    self.postMessage({ type: 'progress', pct });
  }
}

async function build(model, device) {
  return pipeline('automatic-speech-recognition', `Xenova/${model}`, { device, progress_callback: onProgress });
}

async function load(model) {
  if (transcriber && currentModel === model) { self.postMessage({ type: 'ready' }); return; }
  currentModel = model;
  const wantGPU = (typeof navigator !== 'undefined' && 'gpu' in navigator);
  try {
    transcriber = await build(model, wantGPU ? 'webgpu' : 'wasm');
  } catch (_) {
    transcriber = await build(model, 'wasm');   // robust fallback if WebGPU path fails
  }
  self.postMessage({ type: 'ready' });
}

self.onmessage = async (e) => {
  const { type } = e.data;
  try {
    if (type === 'load') {
      await load(e.data.model);
    } else if (type === 'transcribe') {
      if (!transcriber) throw new Error('Model not loaded');
      const opts = {
        chunk_length_s: 30,
        stride_length_s: 5,
        no_repeat_ngram_size: 3,     // guard against Whisper's own repetition loops
        repetition_penalty: 1.2,
      };
      // English-only (".en") Whisper models reject `language`/`task` in transformers.js v4;
      // only set them for multilingual models.
      if (!/\.en$/.test(currentModel || '')) { opts.language = 'en'; opts.task = 'transcribe'; }
      const out = await transcriber(e.data.audio, opts);
      self.postMessage({ type: 'result', text: ((out && out.text) || '').trim() });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
```

- [ ] **Step 2: Add the transcription integration test to the harness**

In `tests/stt-tests.html`, insert this `<script>` block immediately before `</body>` (after the existing test script):

```html
<script>
// ── Integration test: real model transcribes a known clip, no repetition ──
window.runTranscribeTest = async (model = 'whisper-tiny.en') => {
  WhisperSTT.init({ model, callbacks: {
    onProgress: (p) => log('  model load ' + p + '%'),
    onStatus:   (s) => log('  status: ' + s),
  }});

  // Fetch JFK sample, decode + resample to 16 kHz mono via the controller's helper.
  const resp = await fetch('https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav');
  const ab   = await resp.arrayBuffer();
  const ctx  = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await ctx.decodeAudioData(ab.slice(0));
  const audio   = await WhisperSTT._resampleToMono16k(decoded);
  ctx.close();

  const text = (await WhisperSTT._transcribeForTest(audio)).toLowerCase();

  // Accuracy: the JFK clip says "...ask not what your country can do for you...".
  const accurate = text.includes('country') && text.includes('ask');
  // No-repeat regression guard: same word never repeats 4+ times in a row.
  const words = text.replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  let maxRun = 1, run = 1;
  for (let i = 1; i < words.length; i++) { run = words[i] === words[i-1] ? run + 1 : 1; maxRun = Math.max(maxRun, run); }
  const noRepeat = maxRun < 4;

  const result = { passed: accurate && noRepeat, accurate, noRepeat, maxRun, text };
  log('runTranscribeTest → ' + JSON.stringify(result));
  return result;
};
</script>
```

- [ ] **Step 3: Run the integration test and verify it PASSES**

Playwright: navigate to `http://localhost:8753/tests/stt-tests.html`, evaluate `await window.runTranscribeTest('whisper-tiny.en')`.
This downloads tiny.en (~75 MB) on first run — allow up to ~60s.
Expected: `passed: true`, with `text` containing "ask not what your country can do for you", and `maxRun` of 1 (no repetition). If the CDN import 404s, re-run the npm version check from the plan header and bump the URL version.

- [ ] **Step 4: Commit**

```bash
git add js/whisperWorker.js tests/stt-tests.html && git commit -m "feat: add Whisper worker; transcription integration test passes"
```

---

## Task 4: Wire into the app (index.html + capture.js), remove Web Speech

**Files:**
- Modify: `index.html` (add script tag)
- Modify: `js/capture.js` (rewrite `_initVoice`, delete old voice code)

- [ ] **Step 1: Load the controller before capture.js**

In `index.html`, find (line ~583):

```html
  <script src="js/clusterView.js"></script>
  <script src="js/capture.js"></script>
```

Change to:

```html
  <script src="js/clusterView.js"></script>
  <script src="js/whisperSTT.js"></script>
  <script src="js/capture.js"></script>
```

- [ ] **Step 2: Replace the voice section of `js/capture.js`**

Delete the entire block from `// ── VOICE ──` through the end of `_stopRecording()` (current lines ~76–151: the `_initVoice`, `_startRecording`, `_stopRecording` functions). Also delete the now-unused module-state declarations `let _voiceTranscript = '';`, `let _recognition = null;`, `let _isRecording = false;` near the top (lines ~8, 10, 11). Replace the deleted voice section with:

```js
  // ── VOICE (local Whisper STT) ─────────────────────────────────
  function _initVoice() {
    const btn    = document.getElementById('btn-voice');
    const status = document.getElementById('voice-status');
    const tx     = document.getElementById('voice-transcript');
    const usebtn = document.getElementById('btn-capture-voice');

    if (!WhisperSTT.isAvailable()) {
      status.textContent = "Voice transcription isn't supported in this browser";
      btn.disabled = true;
      return;
    }

    const model = (GraphStore.loadSettings().sttModel) || 'whisper-base.en';

    WhisperSTT.init({
      model,
      callbacks: {
        onStatus: (s) => {
          if (s === 'loading') {
            status.textContent = 'Loading speech model…';
          } else if (s === 'recording') {
            status.textContent = '● Recording…';
            btn.classList.add('recording');
            btn.setAttribute('aria-pressed', 'true');
          } else if (s === 'transcribing') {
            status.textContent = 'Transcribing…';
            btn.classList.remove('recording');
            btn.setAttribute('aria-pressed', 'false');
          } else if (s === 'ready') {
            if (!btn.classList.contains('recording')) status.textContent = 'Tap to speak';
          }
        },
        onProgress: (pct) => { status.textContent = `Downloading speech model… ${pct}%`; },
        onResult: (text) => {
          status.textContent = 'Tap to speak';
          if (!text) return App.toast("Didn't catch that, try again", 'warning');
          tx.textContent  = text;
          usebtn.disabled = false;
        },
        onError: (code) => {
          btn.classList.remove('recording');
          btn.setAttribute('aria-pressed', 'false');
          status.textContent = 'Tap to speak';
          const msg = code === 'mic-denied'  ? 'Microphone permission denied'
                    : code === 'too-short'   ? 'Recording too short — try again'
                    : code === 'unavailable' ? 'Voice not supported in this browser'
                    : 'Voice error: ' + code;
          App.toast(msg, 'error');
        },
      },
    });

    btn.addEventListener('click', () => WhisperSTT.toggle());

    usebtn.addEventListener('click', () => {
      const text = (tx.textContent || '').trim();
      if (!text) return App.toast('No transcript yet', 'warning');
      if (_onCaptured) _onCaptured(text, 'voice', null);
      tx.textContent  = '';
      usebtn.disabled = true;
    });
  }
```

Leave `_initVoice()` being called inside `init()` (line ~19) unchanged.

- [ ] **Step 3: Verify no dangling references to the old API**

Run: `grep -n "SpeechRecognition\|_recognition\|_isRecording\|_voiceTranscript\|_startRecording\|_stopRecording" js/capture.js`
Expected: **no output** (all removed).

- [ ] **Step 4: Smoke-test the real page**

Playwright: in localStorage set a dummy key so the Settings modal doesn't auto-open and cover the panel:
evaluate `localStorage.setItem('neuralmind_settings_v1', JSON.stringify({provider:'openai', apiKey:'test', model:'gpt-4o'}))`, then navigate to `http://localhost:8753/index.html`.
Click the **Voice** tab. Evaluate `document.getElementById('btn-voice').disabled` → expected `false`, and `typeof WhisperSTT` → `"object"`. Confirm no new console errors except the known favicon 404.

- [ ] **Step 5: Commit**

```bash
git add index.html js/capture.js && git commit -m "feat: voice capture uses local Whisper; remove Web Speech API"
```

---

## Task 5: Settings — Voice model selector

**Files:**
- Modify: `index.html` (Settings modal)
- Modify: `js/settings.js` (load/save/change)

- [ ] **Step 1: Add the selector to the Settings modal**

In `index.html`, inside the Settings modal, find the second `<div class="setting-divider"></div>` (the one just before the Data `setting-group`, line ~370). Insert this group immediately **after** that divider and **before** `<div class="setting-group">` for Data:

```html
        <div class="setting-group">
          <label class="setting-label" for="stt-model">Voice transcription model</label>
          <select id="stt-model" class="setting-select">
            <option value="whisper-tiny.en">Tiny — fastest (~75 MB)</option>
            <option value="whisper-base.en">Base — balanced (~145 MB)</option>
            <option value="whisper-small.en">Small — most accurate (~480 MB)</option>
          </select>
          <p class="setting-hint">Runs locally in your browser. Downloaded once, then works offline.</p>
        </div>

        <div class="setting-divider"></div>
```

- [ ] **Step 2: Persist and restore `sttModel` in `js/settings.js`**

In `_bindSave` (the `const s = {…}` object, line ~81), add the `sttModel` field:

```js
      const s = {
        provider,
        apiKey:       document.getElementById('api-key').value.trim(),
        model:        document.getElementById('api-model').value,
        ollamaUrl:    document.getElementById('ollama-url').value.trim() || 'http://localhost:11434',
        ollamaModel:  document.getElementById('ollama-model').value.trim(),
        showLabels:   document.getElementById('toggle-labels').checked,
        showWeakLinks: document.getElementById('toggle-weak-links').checked,
        sttModel:     document.getElementById('stt-model').value,
      };
```

In the same handler, after `GraphStore.saveSettings(s);` (line ~90), push the model to the live controller:

```js
      GraphStore.saveSettings(s);
      // WhisperSTT is a top-level const (global lexical binding), NOT window.WhisperSTT.
      if (typeof WhisperSTT !== 'undefined') WhisperSTT.setModel(s.sttModel);
      App.applyGraphOptions(s);
```

In `_loadCurrent` (after line ~104), restore the selection:

```js
    document.getElementById('toggle-weak-links').checked = s.showWeakLinks !== false;
    document.getElementById('stt-model').value = s.sttModel || 'whisper-base.en';
```

- [ ] **Step 3: Verify save/restore**

Playwright: navigate to `http://localhost:8753/index.html`, open Settings (click `#btn-settings`), set `#stt-model` to `whisper-small.en`, click `#btn-save-settings`. Evaluate `JSON.parse(localStorage.getItem('neuralmind_settings_v1')).sttModel` → expected `"whisper-small.en"`. Reopen Settings and evaluate `document.getElementById('stt-model').value` → expected `"whisper-small.en"`.

- [ ] **Step 4: Commit**

```bash
git add index.html js/settings.js && git commit -m "feat: add Voice transcription model selector to Settings"
```

---

## Task 6: CSS for progress / transcribing states

**Files:**
- Modify: `css/style.css`

The Voice widget already has `.voice-status` and `.recording` styles. Add a subtle "busy" treatment so the loading/transcribing text reads as active.

- [ ] **Step 1: Append busy-state styles**

Append to the end of `css/style.css`:

```css
/* ── Whisper STT busy states ── */
.voice-status.busy,
.voice-status:not(:empty) { transition: color .2s ease; }
#voice-status { min-height: 1.2em; }
@keyframes stt-pulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
.voice-btn.recording .mic-icon { animation: stt-pulse 1s ease-in-out infinite; }
```

- [ ] **Step 2: Visual check**

Playwright: navigate to `http://localhost:8753/index.html`, click the Voice tab, take a screenshot. Confirm the Voice widget and status text render without layout shift.

- [ ] **Step 3: Commit**

```bash
git add css/style.css && git commit -m "style: Whisper STT busy/recording states"
```

---

## Task 7: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full test-suite pass**

Playwright: navigate to `http://localhost:8753/tests/stt-tests.html`. Evaluate `await window.runResampleTest()` → `passed:true`. Evaluate `await window.runTranscribeTest('whisper-tiny.en')` → `passed:true`, `noRepeat:true`.

- [ ] **Step 2: Manual mic check (human, real browser)**

In a real browser at `http://localhost:8753/index.html`: open Voice tab → first use shows "Downloading speech model… N%" → after load, click mic, speak the screenshot phrase *"this is a voice work in cricket… I'm testing if this is working correctly as you can see"*, click again. Confirm: (a) the transcript appears as clean text, (b) **no repeated words**, (c) "Use This Transcript" captures a node.

- [ ] **Step 3: Offline check**

Reload the page with network throttled to offline (DevTools) after the model is cached. Confirm transcription still works (model served from browser cache).

- [ ] **Step 4: Final commit + update spec status**

```bash
git add -A && git commit -m "test: verify local Whisper STT end-to-end"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** §1 repetition bug → Tasks 3/4 (record-then-transcribe + `no_repeat_ngram_size`). §2 decisions (engine, remove old, default base.en, English, no COOP/COEP) → Tasks 3–5. §3 architecture (worker/controller/capture boundaries) → Tasks 2–4. §4 data flow → Task 2. §5 UX states → Task 4 callbacks. §6 settings selector → Task 5. §7 edge cases (mic-denied, no-WebGPU fallback, unavailable, too-short, Whisper repetition) → Tasks 2/3/4. §8 testing (resample unit, init/transcription integration, wiring) → Tasks 1/2/3/4. ✔ No gaps.
- **Placeholder scan:** none — all code blocks complete; versions/URLs verified live.
- **Type consistency:** message protocol (`load`/`progress`/`ready`/`transcribe`/`result`/`error`) identical in worker and controller; callback names (`onStatus`/`onProgress`/`onResult`/`onError`) consistent across `whisperSTT.js` and `capture.js`; settings key `sttModel` consistent across `settings.js`, `capture.js`, and the `#stt-model` element. ✔
