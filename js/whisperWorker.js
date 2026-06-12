// whisperWorker.js — runs transformers.js Whisper off the main thread (ESM module worker).
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
      // English-only (".en") Whisper models reject `language`/`task`; only set
      // them for multilingual models.
      if (!/\.en$/.test(currentModel || '')) {
        opts.language = 'en';
        opts.task = 'transcribe';
      }
      const out = await transcriber(e.data.audio, opts);
      self.postMessage({ type: 'result', text: ((out && out.text) || '').trim() });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
