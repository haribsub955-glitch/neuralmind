/* ============================================================
   graphStore.js — localStorage graph database with workspaces
   ============================================================ */

const GraphStore = (() => {
  const WORKSPACES_KEY = 'neuralmind_workspaces_v1';
  const SETTINGS_KEY   = 'neuralmind_settings_v1';
  const GRAPH_PREFIX   = 'neuralmind_graph_';

  // Legacy key (pre-workspace)
  const LEGACY_KEY     = 'neuralmind_graph_v1';

  // ── Internal state ──────────────────────────────────────────
  let _workspaces = [];   // [{id, name, context, icon, color, createdAt}]
  let _activeId   = null;
  let _graph      = { nodes: [], edges: [], clusters: [] };

  // ── Init ────────────────────────────────────────────────────
  function init() {
    _loadWorkspaces();

    // Migration: if legacy data exists and no workspaces, create "General"
    if (_workspaces.length === 0) {
      const generalWs = _createWorkspaceObj('General', 'All thoughts — no specific context', '🧠', '#6C63FF');
      _workspaces.push(generalWs);
      _activeId = generalWs.id;

      // Migrate legacy data if it exists
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        try {
          const legacyGraph = JSON.parse(legacy);
          localStorage.setItem(GRAPH_PREFIX + generalWs.id, JSON.stringify(legacyGraph));
          localStorage.removeItem(LEGACY_KEY);
        } catch (e) {
          console.warn('[GraphStore] legacy migration failed', e);
        }
      }
      _saveWorkspaces();
    }

    if (!_activeId) _activeId = _workspaces[0].id;
    _loadGraph();
  }

  // ── Workspace management ────────────────────────────────────
  function _createWorkspaceObj(name, context, icon, color) {
    return {
      id:        'ws_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name:      name || 'Untitled',
      context:   context || '',
      icon:      icon || '📂',
      color:     color || '#6C63FF',
      createdAt: Date.now(),
    };
  }

  function _loadWorkspaces() {
    const raw = localStorage.getItem(WORKSPACES_KEY);
    if (raw) {
      try {
        const data = JSON.parse(raw);
        _workspaces = data.workspaces || [];
        _activeId   = data.activeId   || null;
      } catch (e) {
        console.warn('[GraphStore] corrupt workspace data');
      }
    }
  }

  function _saveWorkspaces() {
    localStorage.setItem(WORKSPACES_KEY, JSON.stringify({
      workspaces: _workspaces,
      activeId:   _activeId,
    }));
  }

  function _graphKey() {
    return GRAPH_PREFIX + _activeId;
  }

  function _loadGraph() {
    const raw = localStorage.getItem(_graphKey());
    if (raw) {
      try { _graph = JSON.parse(raw); } catch {
        _graph = { nodes: [], edges: [], clusters: [] };
      }
    } else {
      _graph = { nodes: [], edges: [], clusters: [] };
    }
    _graph.nodes    = _graph.nodes    || [];
    _graph.edges    = _graph.edges    || [];
    _graph.clusters = _graph.clusters || [];
  }

  function createWorkspace(name, context, icon, color) {
    const ws = _createWorkspaceObj(name, context, icon, color);
    _workspaces.push(ws);
    _saveWorkspaces();
    // Init empty graph for this workspace
    localStorage.setItem(GRAPH_PREFIX + ws.id, JSON.stringify({ nodes: [], edges: [], clusters: [] }));
    return ws;
  }

  function switchWorkspace(id) {
    const ws = _workspaces.find(w => w.id === id);
    if (!ws) return false;
    _activeId = id;
    _saveWorkspaces();
    _loadGraph();
    return true;
  }

  function updateWorkspace(id, data) {
    const ws = _workspaces.find(w => w.id === id);
    if (!ws) return null;
    if (data.name    !== undefined) ws.name    = data.name;
    if (data.context !== undefined) ws.context = data.context;
    if (data.icon    !== undefined) ws.icon    = data.icon;
    if (data.color   !== undefined) ws.color   = data.color;
    _saveWorkspaces();
    return ws;
  }

  function deleteWorkspace(id) {
    if (_workspaces.length <= 1) return false; // must have at least 1
    _workspaces = _workspaces.filter(w => w.id !== id);
    localStorage.removeItem(GRAPH_PREFIX + id);
    if (_activeId === id) {
      _activeId = _workspaces[0].id;
      _loadGraph();
    }
    _saveWorkspaces();
    return true;
  }

  function getWorkspaces()      { return [..._workspaces]; }
  function getActiveWorkspace()  { return _workspaces.find(w => w.id === _activeId) || null; }
  function getActiveWorkspaceId() { return _activeId; }

  // ── Save ────────────────────────────────────────────────────
  function _save() {
    localStorage.setItem(_graphKey(), JSON.stringify(_graph));
  }

  // ── Node CRUD ────────────────────────────────────────────────
  function addNode(node) {
    const id = 'n_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const newNode = {
      id,
      title:          node.title          || 'Untitled',
      cleaned_thought:node.cleaned_thought || node.raw || '',
      raw:            node.raw            || '',
      type:           node.type           || 'random',
      domain:         node.domain         || 'random',
      entities:       node.entities       || [],
      emotional_weight: node.emotional_weight || 'neutral',
      cluster:        null,
      createdAt:      Date.now(),
      updatedAt:      Date.now(),
      accessCount:    0,
    };
    _graph.nodes.push(newNode);
    _save();
    return newNode;
  }

  function updateNode(id, data) {
    const idx = _graph.nodes.findIndex(n => n.id === id);
    if (idx < 0) return null;
    _graph.nodes[idx] = { ..._graph.nodes[idx], ...data, updatedAt: Date.now() };
    _save();
    return _graph.nodes[idx];
  }

  function deleteNode(id) {
    _graph.nodes  = _graph.nodes.filter(n => n.id !== id);
    _graph.edges  = _graph.edges.filter(e => e.source !== id && e.target !== id);
    _save();
  }

  function getNode(id) {
    return _graph.nodes.find(n => n.id === id) || null;
  }

  function touchNode(id) {
    const node = _graph.nodes.find(n => n.id === id);
    if (node) { node.accessCount++; node.updatedAt = Date.now(); _save(); }
  }

  // ── Edge CRUD (with quality gate) ────────────────────────────
  function addEdge(edge) {
    // ▸ Quality gate: reject low-confidence edges
    const score = edge.score || 0;
    if (score < 0.55) return null;   // hard floor

    // ▸ Reject if reason is suspiciously short (hallucination)
    if (edge.reason && edge.reason.length < 10) return null;

    // ▸ Avoid exact duplicates
    const dup = _graph.edges.find(e =>
      e.source === edge.source && e.target === edge.target &&
      e.relationship === edge.relationship
    );
    if (dup) return dup;

    const id = 'e_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const newEdge = {
      id,
      source:       edge.source,
      target:       edge.target,
      relationship: edge.relationship || 'OVERLAPS',
      score:        score,
      reason:       edge.reason       || '',
      strength:     score >= 0.80 ? 'strong' : 'weak',   // raised from 0.75
      createdAt:    Date.now(),
    };
    _graph.edges.push(newEdge);
    _save();
    return newEdge;
  }

  function addContradiction(sourceId, targetId, tension) {
    return addEdge({
      source: sourceId,
      target: targetId,
      relationship: 'CONTRADICTS',
      score: 0.9,
      reason: tension,
    });
  }

  // ── Clusters ─────────────────────────────────────────────────
  function setClusters(clusters) {
    _graph.clusters = clusters;
    clusters.forEach(cl => {
      (cl.node_ids || []).forEach(nid => {
        const node = _graph.nodes.find(n => n.id === nid);
        if (node) node.cluster = cl.id;
      });
    });
    _save();
  }

  // ── Queries ──────────────────────────────────────────────────
  function getGraph() {
    return JSON.parse(JSON.stringify(_graph));
  }

  function getNodes()    { return [..._graph.nodes]; }
  function getEdges()    { return [..._graph.edges]; }
  function getClusters() { return [..._graph.clusters]; }

  function getRecentNodes(limit = 10) {
    return [..._graph.nodes]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  function getNodeConnections(id) {
    const edges = _graph.edges.filter(e => e.source === id || e.target === id);
    return edges.map(e => {
      const otherId = e.source === id ? e.target : e.source;
      const other   = _graph.nodes.find(n => n.id === otherId);
      return { edge: e, node: other };
    }).filter(c => c.node);
  }

  function getNodeContext(id, depth = 2) {
    const visited = new Set();
    const collect = (nodeId, d) => {
      if (visited.has(nodeId) || d < 0) return;
      visited.add(nodeId);
      if (d > 0) {
        const conns = getNodeConnections(nodeId);
        conns.forEach(c => collect(c.node.id, d - 1));
      }
    };
    collect(id, depth);
    const nodes = [...visited].map(nid => _graph.nodes.find(n => n.id === nid)).filter(Boolean);
    return nodes.map(n => `[${n.id}] "${n.title}" (${n.domain}, ${n.type})`).join('\n');
  }

  function getGraphSummary(maxNodes = 60) {
    const nodes = [..._graph.nodes]
      .sort((a, b) => b.accessCount - a.accessCount || b.createdAt - a.createdAt)
      .slice(0, maxNodes);
    return nodes.map(n =>
      `[${n.id}] "${n.title}" | domain:${n.domain} | type:${n.type} | entities:${(n.entities||[]).join(',')} | cluster:${n.cluster || 'none'}`
    ).join('\n');
  }

  // ── Settings (global, not per-workspace) ────────────────────
  function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }

  function loadSettings() {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {
      provider: 'openai',
      apiKey: '',
      model: 'gpt-4o',
      ollamaUrl: 'http://localhost:11434',
      ollamaModel: 'llama3.2',
      showLabels: true,
      showWeakLinks: true,
    };
    try { return JSON.parse(raw); } catch { return {}; }
  }

  // ── Export / Import (active workspace only) ─────────────────
  function exportJSON() {
    const ws = getActiveWorkspace();
    return JSON.stringify({
      workspace: ws,
      graph: _graph,
      exportedAt: Date.now(),
    }, null, 2);
  }

  function importJSON(jsonStr) {
    const data = JSON.parse(jsonStr);
    if (data.graph) {
      _graph = {
        nodes:    data.graph.nodes    || [],
        edges:    data.graph.edges    || [],
        clusters: data.graph.clusters || [],
      };
      _save();
      return true;
    }
    return false;
  }

  function clearAll() {
    _graph = { nodes: [], edges: [], clusters: [] };
    _save();
  }

  // ── Public API ───────────────────────────────────────────────
  return {
    init,
    // Workspace
    createWorkspace, switchWorkspace, updateWorkspace, deleteWorkspace,
    getWorkspaces, getActiveWorkspace, getActiveWorkspaceId,
    // Node
    addNode, updateNode, deleteNode, getNode, touchNode,
    // Edge
    addEdge, addContradiction,
    // Cluster
    setClusters,
    // Queries
    getGraph, getNodes, getEdges, getClusters,
    getRecentNodes, getNodeConnections,
    getNodeContext, getGraphSummary,
    // Settings
    saveSettings, loadSettings,
    // Data
    exportJSON, importJSON, clearAll,
  };
})();
