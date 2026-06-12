# Local Whisper Speech-to-Text — Design Spec

**Date:** 2026-06-12
**Status:** Approved design (pending spec review)
**Topic:** Replace the browser Web Speech API in Voice capture with an in-browser Whisper model.

---

## 1. Problem & Goal

The app's **Voice** capture mode (`js/capture.js`, `_initVoice`) currently uses the browser
`webkitSpeechRecognition` (Web Speech API). Problems:

- **Chrome/Edge only.** No Firefox; partial/unreliable Safari.
- **Mediocre accuracy**, no control over the model.
- In Chrome it streams audio to Google's servers — not actually local, despite the app's
  local-first framing.
- **Repeats words badly** (observed 2026-06-12). Root cause is a logic bug, not just the engine:
  `onresult` uses `tx.textContent` as the accumulator, but that box already holds the previous
  *interim* guess, so each longer interim is folded back in — producing
  `is is a is a voice is a voice work …`. The record-then-transcribe design removes interim
  merging entirely, eliminating this failure class by construction.

**Goal:** Transcribe spoken thoughts accurately, fully **in the browser** (offline, private, no
API key), working across modern browsers. Captured text flows into the existing pipeline
unchanged.

This is **speech-to-text** (the user referred to it as "TTS"; confirmed it means transcription).

---

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Engine | In-browser Whisper via **`@huggingface/transformers` v4.2.0** (transformers.js, `dist/transformers.js` browser ESM), WebGPU with WASM fallback. English-only `.en` models omit `language`/`task` params. |
| Old Web Speech API | **Removed.** No silent fallback to it. If Whisper can't init, Voice shows a clear disabled message. |
| Default model | **`whisper-base.en`** (~145 MB), with a tiny/base/small selector in Settings. |
| Language | English (`.en` models) to match current `en-US`. Multilingual is a later swap. |
| Cross-origin isolation (COOP/COEP) | **Not enabled.** It would break the app's cross-origin CDN resources (d3, Google Fonts, allorigins proxy). WASM therefore runs single-threaded; WebGPU (no isolation needed) provides the fast path. |

> Open confirmation for spec review: if "use the new one" meant the newest/largest model
> (`large-v3-turbo`) rather than "the new engine," swap the default model id; architecture is unchanged.

---

## 3. Architecture & Boundaries

Three units, each with one responsibility:

### `js/whisperWorker.js` — ML engine (new, ES **module** Web Worker)
- The only place that touches transformers.js. Imports a **pinned** `@huggingface/transformers@3.x`
  from a CDN (jsDelivr/esm.sh).
- Builds an `automatic-speech-recognition` pipeline, downloading + browser-caching the model.
- Receives 16 kHz mono Float32 audio (transferable), returns transcript text.
- Communicates only via `postMessage`. No DOM access.

### `js/whisperSTT.js` — mic + worker controller (new, classic script)
- Public interface used by the rest of the app:
  - `WhisperSTT.init(opts)` — create worker, begin (lazy) model load, wire callbacks.
  - `WhisperSTT.toggle()` — start/stop recording.
  - `WhisperSTT.isAvailable()` — feature-detect (`Worker`, `MediaRecorder`, `getUserMedia`,
    and either WebGPU or WASM).
  - `WhisperSTT.setModel(id)` — change model (re-loads on next use).
  - Callbacks: `onStatus(text)`, `onProgress({pct})`, `onResult(text)`, `onError(message)`.
- Captures mic audio with `MediaRecorder`, decodes + resamples to 16 kHz mono, posts to the worker,
  relays the result. Owns no ML logic.

### `js/capture.js` — DOM wiring (edited)
- `_initVoice` is rewritten to drive `WhisperSTT` against the **existing** DOM
  (`btn-voice`, `voice-status`, `voice-transcript`, `btn-capture-voice`). The capture callback is
  unchanged: `_onCaptured(text, 'voice', null)`. Old `SpeechRecognition` code is removed.

**Why a worker:** model inference would otherwise freeze the UI for seconds. The worker is the clean
seam, and lets the main scripts stay classic `<script>` tags while only the worker uses ESM/CDN imports.

### Load order
In `index.html`, add `<script src="js/whisperSTT.js"></script>` immediately **before**
`<script src="js/capture.js"></script>` (capture.js references `WhisperSTT`). The worker file is
**not** a `<script>` tag — it is referenced by URL inside `whisperSTT.js` via `new Worker(url, {type:'module'})`.

---

## 4. Data Flow

```
click mic
  → getUserMedia + MediaRecorder records (audio/webm;codecs=opus)
click mic again
  → stop → Blob → arrayBuffer
  → AudioContext.decodeAudioData
  → OfflineAudioContext render @ 16000 Hz, mono → Float32Array
  → worker.postMessage({type:'transcribe', audio}, [audio.buffer])   // transferable
  → Whisper pipeline(audio, {chunk_length_s:30, stride_length_s:5, language:'en', task:'transcribe'})
  → {type:'result', text}
  → fill #voice-transcript, enable "Use This Transcript"
click "Use This Transcript"
  → _onCaptured(text, 'voice', null)   // unchanged downstream
```

### Worker message protocol
- → `{type:'load', model}` ; ← `{type:'progress', pct}` … ← `{type:'ready'}`
- → `{type:'transcribe', audio:Float32Array}` (buffer transferred) ; ← `{type:'result', text}`
- ← `{type:'error', message}` on any failure.

---

## 5. UX

- **First use:** lazy-load the model when the Voice tab is first opened (or on first record).
  Status shows `Downloading speech model… NN%` driven by transformers.js `progress_callback`.
  After first load the model is cached in browser Cache Storage → instant + offline thereafter.
- **Recording:** `● Recording…` while capturing. **Record-then-transcribe** (no live interim words —
  this is the deliberate tradeoff for accuracy). On stop: `Transcribing…` spinner, then full text.
- **Idle:** `Tap to speak`.
- **Unavailable:** if `isAvailable()` is false, disable the mic button and show
  `Voice transcription isn't supported in this browser.`

---

## 6. Settings

Add a **Voice** group to the Settings modal (`index.html`) and `js/settings.js`:
- `<select id="stt-model">` → `whisper-tiny.en` (~75 MB) / `whisper-base.en` (~145 MB, default) /
  `whisper-small.en` (~480 MB).
- Persisted via the existing settings store (`GraphStore.loadSettings`/`saveSettings`).
- On change, `WhisperSTT.setModel()` so the next recording uses it (re-download on first use of a new model).

---

## 7. Edge Cases & Error Handling

| Case | Handling |
|---|---|
| Mic permission denied | `onError` → toast, button reverts to idle. |
| No WebGPU | Pipeline created with `device:'wasm'` (single-threaded). Slower but works. |
| Model download fails (offline, blocked) | `onError` → toast "Couldn't load speech model — check connection and retry." Once cached, works offline. |
| Module worker / WASM unsupported | `isAvailable()` false → Voice disabled with message. **No** fallback to old engine. |
| Empty / silent recording | Whisper returns empty/near-empty → toast "Didn't catch that, try again." |
| **Whisper repetition / hallucination** (its own failure mode on silence/noise) | Trim leading/trailing silence before transcribing; pass generation guards (`no_repeat_ngram_size: 3`, `repetition_penalty`, and `compression_ratio`/`logprob` thresholds where exposed by transformers.js). This is the deliberate replacement guard for the old interim-accumulation repetition bug. |
| Long recording | Handled by Whisper 30 s chunking (`chunk_length_s`/`stride_length_s`). |
| Switching tabs mid-record | Stop recording and discard on tab change. |

---

## 8. Testing

ML output is nondeterministic, so tests assert tolerantly:

1. **Resampling unit test** (deterministic, no ML): feed a synthetic 44.1 kHz buffer to the
   decode+resample helper; assert output sample rate 16 kHz, mono, length ≈ duration × 16000.
2. **Worker init / progress (Playwright):** load page, open Voice tab, assert `WhisperSTT.isAvailable()`,
   that a `load` is requested, progress events fire, and `ready` is reached (small/tiny model to keep CI light).
3. **Transcription integration (Playwright):** expose a test-only hook
   `WhisperSTT._transcribeForTest(float32, sampleRate)`; feed a bundled short sample clip with known
   speech; assert the transcript contains expected keywords (substring, case-insensitive).
4. **Capture wiring:** simulate `onResult` → assert `#voice-transcript` fills and
   "Use This Transcript" calls `_onCaptured(text,'voice',null)`.

Driven with the same Playwright tooling used to diagnose the page.

---

## 9. Out of Scope (YAGNI)

- Real-time streaming partial transcripts.
- Multilingual / auto language detection (English-only v1).
- COOP/COEP server + WASM multithreading (conflicts with the app's CDN resources).
- Read-aloud / text-to-speech (a separate, deferred feature).

---

## 10. Files Touched

| File | Change |
|---|---|
| `js/whisperWorker.js` | **New** — module worker running transformers.js Whisper. |
| `js/whisperSTT.js` | **New** — mic capture + worker controller + public API. |
| `js/capture.js` | Rewrite `_initVoice`/`_startRecording`/`_stopRecording` to use `WhisperSTT`; remove `SpeechRecognition`. |
| `index.html` | Add `<script src="js/whisperSTT.js">` before `capture.js`; add Voice model `<select>` to Settings modal. |
| `js/settings.js` | Persist/restore `stt-model`; call `WhisperSTT.setModel` on change. |
| `css/style.css` | Minor: progress bar / `Transcribing…` state styles (reuse existing voice widget styles where possible). |
| (tests) | Resampling unit test + Playwright init/transcription tests. |
