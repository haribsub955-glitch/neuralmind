/* ============================================================
   settings.js — API configuration & data management
   ============================================================ */

const Settings = (() => {

  // Provider → model options
  const MODEL_OPTIONS = {
    openai:    [['gpt-4o','GPT-4o'],['gpt-4o-mini','GPT-4o Mini'],['gpt-4-turbo','GPT-4 Turbo']],
    anthropic: [['claude-opus-4-5','Claude Opus 4.5'],['claude-sonnet-4-5','Claude Sonnet 4.5'],['claude-haiku-3-5','Claude Haiku 3.5']],
    google:    [['gemini-2.0-flash','Gemini 2.0 Flash'],['gemini-1.5-pro','Gemini 1.5 Pro'],['gemini-1.5-flash','Gemini 1.5 Flash']],
    deepseek:  [['deepseek-chat','DeepSeek-V3 (Chat)'],['deepseek-reasoner','DeepSeek-R1 (Reasoner)']],
    ollama:    [],
  };

  function init() {
    _bindOpen();
    _bindClose();
    _bindProvider();
    _bindKeyToggle();
    _bindSave();
    _bindData();
    _loadCurrent();
  }

  function _bindOpen() {
    document.getElementById('btn-settings').addEventListener('click', () => {
      document.getElementById('settings-modal').hidden = false;
      _loadCurrent();
    });
  }

  function _bindClose() {
    document.getElementById('settings-close').addEventListener('click', _close);
    document.getElementById('settings-modal').addEventListener('click', e => {
      if (e.target === e.currentTarget) _close();
    });
  }

  function _close() {
    document.getElementById('settings-modal').hidden = true;
  }

  function _bindProvider() {
    const sel = document.getElementById('api-provider');
    sel.addEventListener('change', () => _updateModelsForProvider(sel.value));
  }

  function _updateModelsForProvider(provider) {
    const modelSel   = document.getElementById('api-model');
    const modelGroup = document.getElementById('model-group');
    const ollamaGroup = document.getElementById('ollama-group');

    if (provider === 'ollama') {
      modelGroup.hidden  = true;
      ollamaGroup.hidden = false;
    } else {
      modelGroup.hidden  = false;
      ollamaGroup.hidden = true;
      const opts = MODEL_OPTIONS[provider] || [];
      modelSel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    }

    // Show DeepSeek hint
    const hint = document.getElementById('deepseek-hint');
    if (hint) hint.hidden = provider !== 'deepseek';
  }

  function _bindKeyToggle() {
    const btn = document.getElementById('btn-toggle-key');
    const inp = document.getElementById('api-key');
    btn.addEventListener('click', () => {
      inp.type = inp.type === 'password' ? 'text' : 'password';
      btn.textContent = inp.type === 'password' ? '👁' : '🙈';
    });
  }

  function _bindSave() {
    document.getElementById('btn-save-settings').addEventListener('click', () => {
      const provider = document.getElementById('api-provider').value;
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
      GraphStore.saveSettings(s);
      // WhisperSTT is a top-level const (global lexical binding), not window.WhisperSTT.
      if (typeof WhisperSTT !== 'undefined') WhisperSTT.setModel(s.sttModel);
      App.applyGraphOptions(s);
      _close();
      App.toast('Settings saved ✓', 'success');
    });
  }

  function _loadCurrent() {
    const s = GraphStore.loadSettings();
    document.getElementById('api-provider').value = s.provider || 'openai';
    document.getElementById('api-key').value      = s.apiKey   || '';
    document.getElementById('ollama-url').value   = s.ollamaUrl || 'http://localhost:11434';
    document.getElementById('ollama-model').value = s.ollamaModel || '';
    document.getElementById('toggle-labels').checked    = s.showLabels !== false;
    document.getElementById('toggle-weak-links').checked = s.showWeakLinks !== false;
    document.getElementById('stt-model').value = s.sttModel || 'whisper-base.en';

    _updateModelsForProvider(s.provider || 'openai');
    // Restore model selection
    setTimeout(() => {
      if (s.model) document.getElementById('api-model').value = s.model;
    }, 0);
  }

  function _bindData() {
    // Export
    document.getElementById('btn-export').addEventListener('click', () => {
      const json = GraphStore.exportJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `neuralmind-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      App.toast('Graph exported ✓', 'success');
    });

    // Import
    const importBtn  = document.getElementById('btn-import');
    const importFile = document.getElementById('import-file-input');
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', () => {
      const file = importFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          GraphStore.importJSON(e.target.result);
          App.refreshViews();
          _close();
          App.toast('Graph imported ✓', 'success');
        } catch {
          App.toast('Invalid JSON file', 'error');
        }
      };
      reader.readAsText(file);
      importFile.value = '';
    });

    // Clear
    document.getElementById('btn-clear-all').addEventListener('click', () => {
      if (confirm('Delete ALL thoughts and connections? This cannot be undone.')) {
        GraphStore.clearAll();
        App.refreshViews();
        _close();
        App.toast('Graph cleared', 'warning');
      }
    });
  }

  return { init };
})();
