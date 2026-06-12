/* ============================================================
   app.js — Bootstrap, state management, event orchestration
   ============================================================ */

const App = (() => {

  // ── State ────────────────────────────────────────────────────
  let _currentView = 'graph';   // 'graph' | 'cluster'
  let _selectedNode = null;
  let _isProcessing = false;

  // ── Init ────────────────────────────────────────────────────
  function init() {
    GraphStore.init();
    GraphView.init('graph-view', _onNodeClick);
    GraphView.setOnEdgeClick(_onEdgeClick);
    ClusterView.init(_onNodeClick);
    Settings.init();
    Capture.init(_onThoughtCaptured);

    _bindViewToggle();
    _bindSearch();
    _bindReflect();
    _bindDetailPanel();
    _bindReasoner();
    _bindWorkspace();

    _syncWorkspaceUI();
    refreshViews();

    // Open settings if no API key configured
    const s = GraphStore.loadSettings();
    if (!s.apiKey && s.provider !== 'ollama') {
      setTimeout(() => {
        document.getElementById('btn-settings').click();
        toast('👋 Welcome! Add your API key to get started.', 'warning');
      }, 800);
    }

    _syncEmptyState();
  }

  // ── Workspace ────────────────────────────────────────────────
  let _editingWorkspaceId = null;

  function _bindWorkspace() {
    const activeBtn  = document.getElementById('workspace-active-btn');
    const dropdown   = document.getElementById('workspace-dropdown');
    const createBtn  = document.getElementById('ws-dropdown-create');
    const modal      = document.getElementById('workspace-modal');
    const modalClose = document.getElementById('ws-modal-close');
    const cancelBtn  = document.getElementById('ws-btn-cancel');
    const saveBtn    = document.getElementById('ws-btn-save');
    const deleteBtn  = document.getElementById('ws-btn-delete');

    // Toggle dropdown
    activeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !dropdown.hidden;
      dropdown.hidden = isOpen;
      activeBtn.setAttribute('aria-expanded', String(!isOpen));
      if (!isOpen) _renderWorkspaceDropdown();
    });

    // Close dropdown on outside click — use mousedown to fire before
    // D3 and other click handlers, and scope check with closest()
    document.addEventListener('mousedown', (e) => {
      if (dropdown.hidden) return;                              // already closed, bail fast
      if (e.target.closest('#workspace-selector')) return;      // inside the selector
      dropdown.hidden = true;
      activeBtn.setAttribute('aria-expanded', 'false');
    });

    // Create workspace
    createBtn.addEventListener('click', () => {
      dropdown.hidden = true;
      activeBtn.setAttribute('aria-expanded', 'false');
      _openWorkspaceModal(null);
    });

    // Modal close
    modalClose.addEventListener('click', () => { modal.hidden = true; });
    cancelBtn.addEventListener('click', () => { modal.hidden = true; });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.hidden = true;
    });

    // Icon picker
    document.getElementById('ws-icon-grid').addEventListener('click', (e) => {
      const btn = e.target.closest('.ws-icon-btn');
      if (!btn) return;
      document.querySelectorAll('.ws-icon-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });

    // Color picker
    document.getElementById('ws-color-grid').addEventListener('click', (e) => {
      const btn = e.target.closest('.ws-color-btn');
      if (!btn) return;
      document.querySelectorAll('.ws-color-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });

    // Save
    saveBtn.addEventListener('click', _saveWorkspace);

    // Delete
    deleteBtn.addEventListener('click', () => {
      if (!_editingWorkspaceId) return;
      const ws = GraphStore.getWorkspaces().find(w => w.id === _editingWorkspaceId);
      if (!ws) return;
      if (!confirm(`Delete workspace "${ws.name}"? All its thoughts will be permanently removed.`)) return;
      GraphStore.deleteWorkspace(_editingWorkspaceId);
      modal.hidden = true;
      _syncWorkspaceUI();
      refreshViews();
      toast(`Workspace "${ws.name}" deleted`, 'warning');
    });
  }

  function _openWorkspaceModal(wsId) {
    _editingWorkspaceId = wsId;
    const modal  = document.getElementById('workspace-modal');
    const title  = document.getElementById('ws-modal-title');
    const nameIn = document.getElementById('ws-input-name');
    const ctxIn  = document.getElementById('ws-input-context');
    const saveBtn = document.getElementById('ws-btn-save');
    const delBtn  = document.getElementById('ws-btn-delete');

    if (wsId) {
      // Edit mode
      const ws = GraphStore.getWorkspaces().find(w => w.id === wsId);
      if (!ws) return;
      title.textContent = '✏️ Edit Workspace';
      nameIn.value = ws.name;
      ctxIn.value  = ws.context || '';
      saveBtn.textContent = 'Save Changes';
      delBtn.hidden = GraphStore.getWorkspaces().length <= 1;

      // Select matching icon
      document.querySelectorAll('.ws-icon-btn').forEach(b => {
        b.classList.toggle('selected', b.dataset.icon === ws.icon);
      });
      // Select matching color
      document.querySelectorAll('.ws-color-btn').forEach(b => {
        b.classList.toggle('selected', b.dataset.color === ws.color);
      });
    } else {
      // Create mode
      title.textContent = '🗂 New Workspace';
      nameIn.value = '';
      ctxIn.value  = '';
      saveBtn.textContent = 'Create Workspace';
      delBtn.hidden = true;

      document.querySelectorAll('.ws-icon-btn').forEach((b, i) => b.classList.toggle('selected', i === 0));
      document.querySelectorAll('.ws-color-btn').forEach((b, i) => b.classList.toggle('selected', i === 0));
    }

    modal.hidden = false;
    nameIn.focus();
  }

  function _saveWorkspace() {
    const name = document.getElementById('ws-input-name').value.trim();
    const ctx  = document.getElementById('ws-input-context').value.trim();
    if (!name) return toast('Workspace name is required', 'warning');

    const selectedIcon  = document.querySelector('.ws-icon-btn.selected');
    const selectedColor = document.querySelector('.ws-color-btn.selected');
    const icon  = selectedIcon  ? selectedIcon.dataset.icon  : '🧠';
    const color = selectedColor ? selectedColor.dataset.color : '#6C63FF';

    if (_editingWorkspaceId) {
      GraphStore.updateWorkspace(_editingWorkspaceId, { name, context: ctx, icon, color });
      toast(`Workspace "${name}" updated`, 'success');
    } else {
      const ws = GraphStore.createWorkspace(name, ctx, icon, color);
      GraphStore.switchWorkspace(ws.id);
      toast(`Workspace "${name}" created`, 'success');
    }

    document.getElementById('workspace-modal').hidden = true;
    _syncWorkspaceUI();
    refreshViews();
  }

  function _renderWorkspaceDropdown() {
    const list      = document.getElementById('ws-dropdown-list');
    const activeId  = GraphStore.getActiveWorkspaceId();
    const workspaces = GraphStore.getWorkspaces();

    list.innerHTML = workspaces.map(ws => {
      // Count nodes in this workspace (only for active, approx for others)
      const isActive = ws.id === activeId;
      const countLabel = isActive ? `${GraphStore.getNodes().length}` : '';
      return `
        <button class="ws-dropdown-item ${isActive ? 'active' : ''}" data-ws-id="${ws.id}">
          <span class="ws-item-dot" style="background:${ws.color}"></span>
          <span class="ws-item-icon">${ws.icon}</span>
          <span class="ws-item-name">${_esc(ws.name)}</span>
          ${countLabel ? `<span class="ws-item-count">${countLabel}</span>` : ''}
          <span class="ws-item-edit" data-ws-edit="${ws.id}" title="Edit">✎</span>
        </button>
      `;
    }).join('');

    // Bind switch
    list.querySelectorAll('.ws-dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // If edit button clicked
        if (e.target.closest('.ws-item-edit')) {
          e.stopPropagation();
          const editId = e.target.closest('.ws-item-edit').dataset.wsEdit;
          document.getElementById('workspace-dropdown').hidden = true;
          _openWorkspaceModal(editId);
          return;
        }
        const wsId = item.dataset.wsId;
        if (wsId === activeId) {
          document.getElementById('workspace-dropdown').hidden = true;
          return;
        }
        GraphStore.switchWorkspace(wsId);
        document.getElementById('workspace-dropdown').hidden = true;
        document.getElementById('workspace-active-btn').setAttribute('aria-expanded', 'false');
        _syncWorkspaceUI();
        _selectNode(null);
        refreshViews();
        toast(`Switched to "${GraphStore.getActiveWorkspace().name}"`, 'success');
      });
    });
  }

  function _syncWorkspaceUI() {
    const ws = GraphStore.getActiveWorkspace();
    if (!ws) return;
    document.getElementById('ws-name').textContent = ws.name;
    document.getElementById('ws-dot').style.background = ws.color;
  }

  // ── View Toggle ──────────────────────────────────────────────
  function _bindViewToggle() {
    document.getElementById('btn-graph-view').addEventListener('click', () => {
      _setView('graph');
    });
    document.getElementById('btn-cluster-view').addEventListener('click', () => {
      _setView('cluster');
    });
  }

  function _setView(view) {
    _currentView = view;
    const graphView   = document.getElementById('graph-view');
    const clusterView = document.getElementById('cluster-view');
    const btnGraph    = document.getElementById('btn-graph-view');
    const btnCluster  = document.getElementById('btn-cluster-view');

    if (view === 'graph') {
      graphView.hidden   = false;
      clusterView.hidden = true;
      btnGraph.classList.add('active');
      btnCluster.classList.remove('active');
      refreshViews();
    } else {
      graphView.hidden   = true;
      clusterView.hidden = false;
      btnGraph.classList.remove('active');
      btnCluster.classList.add('active');
      const graph = GraphStore.getGraph();
      ClusterView.render(graph);
    }
  }

  // ── Search ───────────────────────────────────────────────────
  function _bindSearch() {
    const input = document.getElementById('search-input');
    let debounce;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => _doSearch(input.value.trim()), 350);
    });

    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const q = input.value.trim();
        if (!q) return;
        // Semantic surface via LLM
        try {
          const result = await PromptLoop.stepSurface(q);
          const nodeIds = (result.relevant_nodes || []).map(r => r.id);
          if (nodeIds[0]) {
            const node = GraphStore.getNode(nodeIds[0]);
            if (node) {
              _onNodeClick(node);
              GraphView.focusNode(nodeIds[0]);
            }
          }
          if (result.follow_up_question) {
            toast(`💡 ${result.follow_up_question}`, 'success');
          }
        } catch (err) {
          // Fallback: text search
          _doSearch(q);
        }
      }
    });
  }

  function _doSearch(q) {
    if (!q) return;
    const lq    = q.toLowerCase();
    const nodes = GraphStore.getNodes();
    const match = nodes.find(n =>
      n.title.toLowerCase().includes(lq) ||
      (n.cleaned_thought || '').toLowerCase().includes(lq) ||
      (n.entities || []).some(e => e.toLowerCase().includes(lq))
    );
    if (match && _currentView === 'graph') {
      GraphView.focusNode(match.id);
      _onNodeClick(match);
    }
  }

  // ── Reflect ──────────────────────────────────────────────────
  function _bindReflect() {
    document.getElementById('btn-reflect').addEventListener('click', _runReflect);
    document.getElementById('reflect-close').addEventListener('click', () => {
      document.getElementById('reflect-modal').hidden = true;
    });
    document.getElementById('reflect-modal').addEventListener('click', e => {
      if (e.target === e.currentTarget) document.getElementById('reflect-modal').hidden = true;
    });
  }

  async function _runReflect() {
    const nodes = GraphStore.getNodes();
    if (nodes.length < 3) {
      return toast('Add at least 3 thoughts before reflecting', 'warning');
    }

    const modal   = document.getElementById('reflect-modal');
    const loading = document.getElementById('reflect-loading');
    const results = document.getElementById('reflect-results');

    modal.hidden   = false;
    loading.hidden = false;
    results.hidden = true;

    try {
      const data = await PromptLoop.stepReflect();
      _renderReflect(data);
      loading.hidden = true;
      results.hidden = false;
    } catch (err) {
      modal.hidden = true;
      toast('Reflection failed: ' + err.message, 'error');
    }
  }

  function _renderReflect(data) {
    document.getElementById('reflect-narrative').textContent = data.narrative || '';

    const themes = document.getElementById('reflect-themes');
    themes.innerHTML = (data.emerging_themes || []).map(t => `<li>${t}</li>`).join('');

    const tensions = document.getElementById('reflect-tensions');
    tensions.innerHTML = (data.recurring_tensions || []).map(t =>
      `<li><strong>${t.theme_a}</strong> vs <strong>${t.theme_b}</strong>: ${t.tension}</li>`
    ).join('');

    const dormant = document.getElementById('reflect-dormant');
    dormant.innerHTML = (data.dormant_ideas || []).map(id => {
      const node = GraphStore.getNode(id);
      return node ? `<li>${node.title}</li>` : '';
    }).join('');

    const questions = document.getElementById('reflect-questions');
    questions.innerHTML = (data.synthesis_questions || []).map(q => `<li>${q}</li>`).join('');

    document.getElementById('reflect-next-action').textContent = data.next_action || '';
  }

  // ── Connection Reasoner ───────────────────────────────────────
  function _bindReasoner() {
    document.getElementById('reasoner-close').addEventListener('click', _closeReasoner);
  }

  function _openReasoner(edge, nodeA, nodeB) {
    if (!nodeA || !nodeB) return;

    const drawer   = document.getElementById('reasoner-drawer');
    const loading  = document.getElementById('reasoner-loading');
    const body     = document.getElementById('reasoner-body');
    const subtitle = document.getElementById('reasoner-subtitle');

    // Fill node pills + rel badge immediately
    document.getElementById('reasoner-node-a').textContent = nodeA.title;
    document.getElementById('reasoner-node-b').textContent = nodeB.title;
    const relColor = GraphView.relColor(edge.relationship);
    const badge = document.getElementById('reasoner-rel-badge');
    badge.textContent = (edge.relationship || 'LINKED').replace(/_/g, ' ');
    badge.style.color = relColor;
    badge.style.borderColor = relColor + '55';
    badge.style.background  = relColor + '18';
    subtitle.textContent = `${nodeA.title} → ${nodeB.title}`;

    // Show drawer
    drawer.classList.add('open');
    loading.hidden = false;
    body.hidden    = true;

    // Fire LLM
    PromptLoop.stepConnectionReason(nodeA, nodeB, edge)
      .then(result => {
        _renderReasoner(result);
        loading.hidden = true;
        body.hidden    = false;
      })
      .catch(err => {
        _closeReasoner();
        toast('Reasoner failed: ' + err.message, 'error');
      });
  }

  function _closeReasoner() {
    document.getElementById('reasoner-drawer').classList.remove('open');
  }

  function _renderReasoner(r) {
    // Summary bar
    document.getElementById('reasoner-summary').textContent = r.one_line_summary || '';

    // Shared Abstractions
    const absList = document.getElementById('rc-abstractions-list');
    absList.innerHTML = (r.shared_abstractions || []).map(a => `<li>${_esc(a)}</li>`).join('');

    // Logical Dependency
    document.getElementById('rc-dependency-text').textContent = r.logical_dependency || '—';

    // Causal Mechanism
    document.getElementById('rc-mechanism-text').textContent = r.causal_mechanism || '—';

    // Information Overlap
    const overlapList = document.getElementById('rc-overlap-list');
    overlapList.innerHTML = (r.information_overlap || []).map(o => `<li>${_esc(o)}</li>`).join('');

    // Structural Isomorphism
    document.getElementById('rc-isomorphism-text').textContent = r.structural_isomorphism || '—';

    // Divergence Point
    document.getElementById('rc-divergence-text').textContent = r.divergence_point || '—';

    // Synthesis Vector
    document.getElementById('rc-synthesis-text').textContent = r.synthesis_vector || '—';
  }

  function _onEdgeClick(edge, srcNode, tgtNode) {
    _openReasoner(edge, srcNode, tgtNode);
  }

  // ── Detail Panel ─────────────────────────────────────────────
  function _bindDetailPanel() {
    document.getElementById('detail-close').addEventListener('click', () => {
      _selectNode(null);
    });
    document.getElementById('btn-expand-node').addEventListener('click', () => {
      if (_selectedNode && _currentView === 'graph') {
        GraphView.focusNode(_selectedNode.id);
      }
    });
    document.getElementById('btn-delete-node').addEventListener('click', () => {
      if (!_selectedNode) return;
      if (confirm(`Delete "${_selectedNode.title}"?`)) {
        GraphStore.deleteNode(_selectedNode.id);
        _selectNode(null);
        refreshViews();
        toast('Node deleted', 'warning');
      }
    });
  }

  function _onNodeClick(node) {
    _selectNode(node);
  }

  function _selectNode(node) {
    _selectedNode = node;
    const empty   = document.getElementById('detail-empty');
    const content = document.getElementById('detail-content');

    if (!node) {
      empty.hidden   = false;
      content.hidden = true;
      return;
    }

    GraphStore.touchNode(node.id);
    empty.hidden   = true;
    content.hidden = false;

    document.getElementById('detail-type-badge').textContent = node.type || 'thought';
    document.getElementById('detail-title').textContent      = node.title;
    document.getElementById('detail-thought').textContent    = node.cleaned_thought || node.raw || '';
    document.getElementById('detail-domain').textContent     = '🏷 ' + (node.domain || 'random');
    document.getElementById('detail-emotion').textContent    = _emotionEmoji(node.emotional_weight) + ' ' + (node.emotional_weight || '');
    document.getElementById('detail-date').textContent       = _relTime(node.createdAt);

    // Entities
    const entList = document.getElementById('detail-entities');
    entList.innerHTML = (node.entities || [])
      .map(e => `<span class="entity-chip">${e}</span>`)
      .join('');

    // Connections
    const connList = document.getElementById('detail-connections');
    const conns    = GraphStore.getNodeConnections(node.id);
    if (conns.length === 0) {
      connList.innerHTML = '<span style="font-size:0.75rem;color:var(--text-muted)">No connections yet</span>';
    } else {
      connList.innerHTML = conns.map(c =>
        `<div class="connection-item" data-id="${c.node.id}">
          <span class="connection-rel">${c.edge.relationship || '~'}</span>
          <span class="connection-title">${c.node.title}</span>
        </div>`
      ).join('');

      connList.querySelectorAll('.connection-item').forEach(item => {
        item.addEventListener('click', () => {
          const targetNode = GraphStore.getNode(item.dataset.id);
          if (targetNode) {
            _selectNode(targetNode);
            if (_currentView === 'graph') GraphView.focusNode(targetNode.id);
          }
        });
      });
    }
  }

  // ── Capture pipeline ─────────────────────────────────────────
  async function _onThoughtCaptured(rawText, mediaType, imageBase64) {
    if (_isProcessing) return toast('Still processing previous thought…', 'warning');

    const s = GraphStore.loadSettings();
    if (!s.apiKey && s.provider !== 'ollama') {
      document.getElementById('btn-settings').click();
      return toast('Configure your API key first', 'error');
    }

    _isProcessing = true;
    _showProcessing(true);

    try {
      const { node } = await PromptLoop.processThought(rawText, {
        mediaType,
        imageBase64,
        onStep: (step, state) => _updateProcessStep(step, state),
      });

      _showProcessing(false);
      refreshViews();
      _syncEmptyState();

      // Select the new node
      setTimeout(() => {
        _selectNode(node);
        if (_currentView === 'graph') GraphView.focusNode(node.id);
      }, 400);

      _addRecentItem(node);
      toast(`✓ "${node.title}" captured`, 'success');

    } catch (err) {
      _showProcessing(false);
      console.error('[App] pipeline error', err);
      toast('Error: ' + err.message, 'error');
    } finally {
      _isProcessing = false;
    }
  }

  function _showProcessing(show) {
    document.getElementById('processing-overlay').hidden = !show;
    if (show) {
      // Reset all steps
      [1, 2, 3].forEach(i => {
        const el = document.getElementById(`proc-step-${i}`);
        el.classList.remove('active', 'done');
      });
    }
  }

  function _updateProcessStep(stepIndex, state) {
    const el = document.getElementById(`proc-step-${stepIndex}`);
    if (!el) return;
    el.classList.remove('active', 'done');
    if (state === 'active') el.classList.add('active');
    if (state === 'done')   el.classList.add('done');
  }

  // ── Recent list ──────────────────────────────────────────────
  function _addRecentItem(node) {
    const list = document.getElementById('recent-list');
    const item = document.createElement('div');
    item.className = 'recent-item';
    item.setAttribute('data-id', node.id);
    item.innerHTML = `
      <div class="recent-item-dot" style="background:${GraphView.domainColor(node.domain)}"></div>
      <div>
        <div class="recent-item-text">${_esc(node.title)}</div>
        <div class="recent-item-time">just now</div>
      </div>
    `;
    item.addEventListener('click', () => {
      _selectNode(node);
      if (_currentView === 'graph') GraphView.focusNode(node.id);
    });
    list.prepend(item);
    // Keep only 20 recent items in DOM
    while (list.children.length > 20) list.lastChild.remove();
  }

  function _populateRecentList() {
    const list  = document.getElementById('recent-list');
    list.innerHTML = '';
    const recent = GraphStore.getRecentNodes(15);
    recent.forEach(node => {
      const item = document.createElement('div');
      item.className = 'recent-item';
      item.setAttribute('data-id', node.id);
      item.innerHTML = `
        <div class="recent-item-dot" style="background:${GraphView.domainColor(node.domain)}"></div>
        <div>
          <div class="recent-item-text">${_esc(node.title)}</div>
          <div class="recent-item-time">${_relTime(node.createdAt)}</div>
        </div>
      `;
      item.addEventListener('click', () => {
        _selectNode(node);
        if (_currentView === 'graph') GraphView.focusNode(node.id);
      });
      list.appendChild(item);
    });
  }

  // ── Refresh ──────────────────────────────────────────────────
  function refreshViews() {
    const graph = GraphStore.getGraph();
    const nodes = graph.nodes;
    const s = GraphStore.loadSettings();

    // Update count badge
    document.getElementById('node-count').textContent =
      nodes.length === 0 ? '0 thoughts' :
      nodes.length === 1 ? '1 thought'  : `${nodes.length} thoughts`;

    if (_currentView === 'graph') {
      GraphView.render(graph, {
        showLabels:   s.showLabels !== false,
        showWeakLinks: s.showWeakLinks !== false,
      });
    } else {
      ClusterView.render(graph);
    }

    _populateRecentList();
    _syncEmptyState();
  }

  function _syncEmptyState() {
    const nodes   = GraphStore.getNodes();
    const empty   = document.getElementById('empty-state');
    if (nodes.length === 0) {
      empty.classList.remove('hidden');
    } else {
      empty.classList.add('hidden');
    }
  }

  function applyGraphOptions(s) {
    GraphView.setShowLabels(s.showLabels !== false);
    GraphView.setShowWeakLinks(s.showWeakLinks !== false);
    refreshViews();
  }

  // ── Toast ────────────────────────────────────────────────────
  function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('leaving');
      el.addEventListener('animationend', () => el.remove());
    }, 3500);
  }

  // ── Utilities ────────────────────────────────────────────────
  function _emotionEmoji(w) {
    const map = {
      excited: '🔥', curious: '🤔', anxious: '😰',
      determined: '💪', melancholic: '🌧', energized: '⚡', neutral: '—',
    };
    return map[w] || '—';
  }

  function _relTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(ts).toLocaleDateString();
  }

  function _esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Public API ───────────────────────────────────────────────
  return { init, toast, refreshViews, applyGraphOptions };
})();

// ── Bootstrap ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
