/* ============================================================
   mobile.js — Touch-first navigation layer for NeuralMind

   Reuses the entire desktop app (same DOM/IDs/JS). It only adds the
   mobile *chrome*: a bottom nav with a capture FAB, sliding bottom
   sheets for the Capture & Detail panels, and a slide-down search.

   Design notes
   ------------
   • State lives in <body> classes (.m-capture-open / .m-detail-open /
     .m-search-open); css/mobile.css does the visuals inside the
     ≤768px breakpoint, so none of this affects desktop.
   • The Detail sheet is driven by the app's own selection state: we
     observe #detail-content's `hidden` attribute, so node clicks from
     anywhere (graph, recents, connections, search) open the sheet, and
     the existing close/delete flows close it — no app.js changes needed.
   ============================================================ */

const Mobile = (() => {
  const mq = window.matchMedia('(max-width: 768px)');
  const body = document.body;

  // Cache nodes
  let capturePanel, detailPanel, scrim, searchOverlay, searchInner, nav;
  let searchBar, searchOrigParent;   // for relocating .search-bar

  function init() {
    capturePanel  = document.getElementById('capture-panel');
    detailPanel   = document.getElementById('detail-panel');
    scrim         = document.getElementById('mobile-scrim');
    searchOverlay = document.getElementById('mobile-search');
    searchInner   = document.getElementById('mobile-search-inner');
    nav           = document.getElementById('mobile-nav');
    searchBar     = document.querySelector('.topbar .search-bar');
    searchOrigParent = searchBar ? searchBar.parentElement : null;

    _injectHandles();
    _bindNav();
    _bindScrim();
    _bindSearch();
    _bindDragDismiss();
    _observeDetail();
    _observeProcessing();
    _syncViewActive('graph');

    mq.addEventListener('change', _applyMode);
    _applyMode();
  }

  /* ── Mobile <-> desktop switch ─────────────────────────────── */
  function _applyMode() {
    const m = mq.matches;
    body.classList.toggle('is-mobile', m);
    if (m) {
      // Host the live search bar inside the slide-down overlay
      if (searchBar && searchBar.parentElement !== searchInner) {
        searchInner.appendChild(searchBar);
      }
    } else {
      // Restore everything to its desktop home
      if (searchBar && searchOrigParent && searchBar.parentElement !== searchOrigParent) {
        searchOrigParent.appendChild(searchBar);
      }
      _closeSheets();
      body.classList.remove('m-search-open');
    }
  }

  /* ── Drag handles at the top of each sheet ─────────────────── */
  function _injectHandles() {
    [capturePanel, detailPanel].forEach(panel => {
      if (!panel || panel.querySelector('.sheet-handle')) return;
      const h = document.createElement('div');
      h.className = 'sheet-handle';
      h.setAttribute('aria-hidden', 'true');
      panel.prepend(h);
    });
  }

  /* ── Bottom navigation ─────────────────────────────────────── */
  function _bindNav() {
    document.getElementById('mnav-graph')?.addEventListener('click', () => {
      document.getElementById('btn-graph-view')?.click();
      _closeSheets();
      _syncViewActive('graph');
    });
    document.getElementById('mnav-cluster')?.addEventListener('click', () => {
      document.getElementById('btn-cluster-view')?.click();
      _closeSheets();
      _syncViewActive('cluster');
    });
    document.getElementById('mnav-capture')?.addEventListener('click', () => {
      _openCapture();
    });
    document.getElementById('mnav-search')?.addEventListener('click', () => {
      _openSearch();
    });
    document.getElementById('mnav-reflect')?.addEventListener('click', () => {
      _closeSheets();
      document.getElementById('btn-reflect')?.click();
    });

    // Empty-state CTA should also reveal the capture sheet, then focus
    document.getElementById('btn-empty-cta')?.addEventListener('click', () => {
      _openCapture();
      setTimeout(() => document.getElementById('thought-input')?.focus(), 340);
    });
  }

  function _syncViewActive(view) {
    document.getElementById('mnav-graph')?.classList.toggle('active', view === 'graph');
    document.getElementById('mnav-cluster')?.classList.toggle('active', view === 'cluster');
  }

  /* ── Scrim (tap-to-dismiss) ────────────────────────────────── */
  function _bindScrim() {
    scrim?.addEventListener('click', () => {
      if (body.classList.contains('m-search-open')) return _closeSearch();
      if (body.classList.contains('m-detail-open')) {
        // Keep app selection state in sync
        document.getElementById('detail-close')?.click();
        return;
      }
      _closeSheets();
    });
  }

  function _showScrim() { if (scrim) scrim.hidden = false; }
  function _hideScrimIfIdle() {
    const open = body.classList.contains('m-capture-open') ||
                 body.classList.contains('m-detail-open')  ||
                 body.classList.contains('m-search-open');
    if (scrim) scrim.hidden = open ? false : true;
  }

  /* ── Capture sheet ─────────────────────────────────────────── */
  function _openCapture() {
    body.classList.remove('m-detail-open', 'm-search-open');
    body.classList.add('m-capture-open');
    _showScrim();
  }
  function _closeSheets() {
    body.classList.remove('m-capture-open', 'm-detail-open');
    _hideScrimIfIdle();
  }

  /* ── Detail sheet (driven by app selection state) ──────────── */
  function _observeDetail() {
    const content = document.getElementById('detail-content');
    if (!content) return;
    const obs = new MutationObserver(() => {
      const open = !content.hidden;
      if (open) {
        body.classList.remove('m-capture-open', 'm-search-open');
        body.classList.add('m-detail-open');
        _showScrim();
      } else {
        body.classList.remove('m-detail-open');
        _hideScrimIfIdle();
      }
    });
    obs.observe(content, { attributes: true, attributeFilter: ['hidden'] });
  }

  /* ── Auto-close sheets when a capture starts processing ────── */
  function _observeProcessing() {
    const ov = document.getElementById('processing-overlay');
    if (!ov) return;
    const obs = new MutationObserver(() => {
      if (!ov.hidden) {
        body.classList.remove('m-capture-open', 'm-search-open');
        _hideScrimIfIdle();
      }
    });
    obs.observe(ov, { attributes: true, attributeFilter: ['hidden'] });
  }

  /* ── Search overlay ────────────────────────────────────────── */
  function _bindSearch() {
    document.getElementById('mobile-search-cancel')?.addEventListener('click', _closeSearch);
    // Submitting search (Enter) closes the overlay so results are visible
    const input = document.getElementById('search-input');
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') _closeSearch(); });
  }
  function _openSearch() {
    body.classList.remove('m-capture-open', 'm-detail-open');
    body.classList.add('m-search-open');
    _showScrim();
    setTimeout(() => document.getElementById('search-input')?.focus(), 300);
  }
  function _closeSearch() {
    body.classList.remove('m-search-open');
    document.getElementById('search-input')?.blur();
    _hideScrimIfIdle();
  }

  /* ── Drag-to-dismiss for bottom sheets ─────────────────────── */
  function _bindDragDismiss() {
    _makeDraggable(capturePanel, _closeSheets);
    _makeDraggable(detailPanel, () => document.getElementById('detail-close')?.click());
  }

  function _makeDraggable(panel, onDismiss) {
    if (!panel) return;
    let startY = 0, dy = 0, dragging = false;

    const grip = () => panel.querySelector('.sheet-handle');

    panel.addEventListener('touchstart', e => {
      // Only start a drag from the handle or panel header (not scroll areas)
      const t = e.target;
      if (!t.closest('.sheet-handle') && !t.closest('.panel-header') && !t.closest('.detail-header')) return;
      dragging = true;
      startY = e.touches[0].clientY;
      dy = 0;
      panel.style.transition = 'none';
    }, { passive: true });

    panel.addEventListener('touchmove', e => {
      if (!dragging) return;
      dy = e.touches[0].clientY - startY;
      if (dy < 0) dy = 0;                 // don't drag upward past open
      panel.style.transform = `translateY(${dy}px)`;
    }, { passive: true });

    panel.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = '';
      panel.style.transform = '';
      if (dy > 110) onDismiss();          // past threshold → dismiss
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => Mobile.init());
