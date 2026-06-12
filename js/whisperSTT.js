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
  let _recorder = null, _stream = null, _chunks = [], _recording = false, _starting = false;
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
    _worker.onerror = (err) => {
      _loading = false; _ready = false;   // don't wedge future load retries
      _cb.onError('worker:' + (err.message || 'load failed'));
    };
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
    if (_starting || _recording) return;   // ignore re-taps during the permission prompt
    _starting = true;
    _ensureLoaded();
    try {
      _stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (_) { _starting = false; _cb.onError('mic-denied'); return; }
    _chunks = [];
    _recorder = new MediaRecorder(_stream);
    _recorder.ondataavailable = (e) => { if (e.data && e.data.size) _chunks.push(e.data); };
    _recorder.onstop = _onStop;
    _recorder.start();
    _recording = true;
    _starting = false;
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
