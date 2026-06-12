/* ============================================================
   capture.js — All capture modes: text, voice, image, link
   ============================================================ */

const Capture = (() => {

  let _onCaptured = null;   // callback(rawText, mediaType, imageBase64)
  let _imageBase64 = null;

  // ── Init ────────────────────────────────────────────────────
  function init(onCaptured) {
    _onCaptured = onCaptured;

    _initTabs();
    _initText();
    _initVoice();
    _initImage();
    _initLink();
  }

  // ── TAB SWITCHING ────────────────────────────────────────────
  function _initTabs() {
    const tabs = document.querySelectorAll('.capture-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.mode;
        tabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');

        document.querySelectorAll('.capture-mode').forEach(m => m.classList.remove('active'));
        document.getElementById(`mode-${mode}`).classList.add('active');
      });
    });

    // Empty state CTA → focus text tab
    document.getElementById('btn-empty-cta')?.addEventListener('click', () => {
      document.getElementById('tab-text')?.click();
      document.getElementById('thought-input')?.focus();
    });
  }

  // ── TEXT ─────────────────────────────────────────────────────
  function _initText() {
    const ta    = document.getElementById('thought-input');
    const btn   = document.getElementById('btn-capture-text');
    const count = document.getElementById('char-count');

    ta.addEventListener('input', () => {
      count.textContent = ta.value.length;
    });

    ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        _submitText();
      }
    });

    btn.addEventListener('click', _submitText);
  }

  function _submitText() {
    const ta = document.getElementById('thought-input');
    const text = ta.value.trim();
    if (!text) return App.toast('Type something first!', 'warning');

    if (_onCaptured) _onCaptured(text, 'text', null);
    ta.value = '';
    document.getElementById('char-count').textContent = '0';
  }

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

  // ── IMAGE ─────────────────────────────────────────────────────
  function _initImage() {
    const zone     = document.getElementById('image-drop-zone');
    const fileIn   = document.getElementById('image-file-input');
    const preview  = document.getElementById('image-preview');
    const wrapper  = document.getElementById('image-preview-wrapper');
    const zoneBody = zone.querySelector('.drop-zone-content');
    const removeB  = document.getElementById('remove-image');
    const captureB = document.getElementById('btn-capture-image');

    // Click to browse
    zone.addEventListener('click', (e) => {
      if (!_imageBase64) fileIn.click();
    });

    zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileIn.click(); });

    fileIn.addEventListener('change', () => {
      if (fileIn.files[0]) _loadImage(fileIn.files[0]);
    });

    // Drag & drop
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) _loadImage(file);
    });

    removeB.addEventListener('click', (e) => {
      e.stopPropagation();
      _imageBase64 = null;
      preview.src  = '';
      wrapper.hidden  = true;
      zoneBody.hidden = false;
      captureB.disabled = true;
      fileIn.value = '';
    });

    captureB.addEventListener('click', () => {
      if (!_imageBase64) return;
      const ctx = document.getElementById('image-context').value.trim();
      const prompt = ctx
        ? `Describe this image and its key ideas. Context: ${ctx}`
        : 'Describe this image and extract the key ideas, concepts, and themes from it.';
      if (_onCaptured) _onCaptured(prompt, 'image', _imageBase64);
      // Reset
      removeB.click();
      document.getElementById('image-context').value = '';
    });

    function _loadImage(file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        _imageBase64  = dataUrl.split(',')[1]; // strip prefix
        preview.src   = dataUrl;
        wrapper.hidden  = false;
        zoneBody.hidden = true;
        captureB.disabled = false;
      };
      reader.readAsDataURL(file);
    }
  }

  // ── LINK ─────────────────────────────────────────────────────
  function _initLink() {
    const input   = document.getElementById('link-input');
    const preview = document.getElementById('link-preview-card');
    const domain  = document.getElementById('link-preview-domain');
    const title   = document.getElementById('link-preview-title');
    const captureB = document.getElementById('btn-capture-link');
    let _debounce;

    input.addEventListener('input', () => {
      clearTimeout(_debounce);
      _debounce = setTimeout(() => _fetchLinkPreview(input.value.trim()), 600);
    });

    captureB.addEventListener('click', () => {
      const url   = input.value.trim();
      const notes = document.getElementById('link-notes').value.trim();
      if (!url) return App.toast('Paste a URL first', 'warning');

      let text = `Link: ${url}`;
      if (title.textContent) text = `${title.textContent}\n${url}`;
      if (notes) text += `\nNotes: ${notes}`;

      if (_onCaptured) _onCaptured(text, 'link', null);
      input.value = '';
      document.getElementById('link-notes').value = '';
      preview.hidden = true;
      domain.textContent = '';
      title.textContent  = '';
    });
  }

  async function _fetchLinkPreview(url) {
    const preview = document.getElementById('link-preview-card');
    const domainEl = document.getElementById('link-preview-domain');
    const titleEl  = document.getElementById('link-preview-title');

    if (!url.startsWith('http')) { preview.hidden = true; return; }

    try {
      const u = new URL(url);
      domainEl.textContent = u.hostname;
      titleEl.textContent  = 'Fetching…';
      preview.hidden = false;

      // Use allorigins proxy to fetch page title (CORS-free)
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
      const res  = await fetch(proxyUrl, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      const match = data.contents?.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (match) titleEl.textContent = match[1].trim().slice(0, 100);
      else        titleEl.textContent = u.hostname;
    } catch {
      document.getElementById('link-preview-domain').textContent = 'URL';
      document.getElementById('link-preview-title').textContent  = url.slice(0, 60);
    }
  }

  // ── Public API ───────────────────────────────────────────────
  return { init };
})();
