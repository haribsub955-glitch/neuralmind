/* ============================================================
   graphView.js — D3.js force-directed graph
   ============================================================ */

const GraphView = (() => {

  // ── State ────────────────────────────────────────────────────
  let svg, g, simulation;
  let nodes = [], links = [];
  let width = 800, height = 600;
  let zoom;
  let currentTransform = d3.zoomIdentity;
  let selectedNodeId = null;
  let selectedEdgeId = null;
  let onNodeClick = null;   // callback(node)
  let onEdgeClick = null;   // callback(edgeData, sourceNode, targetNode)
  let showLabels = true;
  let showWeakLinks = true;

  // Domain → color map
  const DOMAIN_COLORS = {
    philosophy:  '#6C63FF',
    work:        '#3B82F6',
    creativity:  '#EC4899',
    science:     '#10B981',
    technology:  '#06B6D4',
    personal:    '#F59E0B',
    health:      '#84CC16',
    finance:     '#F97316',
    education:   '#8B5CF6',
    random:      '#64748B',
  };

  // Relationship → color
  const REL_COLORS = {
    BUILDS_ON:    '#6C63FF',
    SUPPORTS:     '#10B981',
    INSPIRES:     '#F59E0B',
    PART_OF:      '#3B82F6',
    LEADS_TO:     '#A78BFA',
    SIMILAR_TO:   '#64748B',
    OVERLAPS:     '#64748B',
    TRIGGERED_BY: '#EC4899',
    ELABORATES:   '#06B6D4',
    CONTRADICTS:  '#EF4444',
  };

  function domainColor(domain) {
    return DOMAIN_COLORS[domain] || '#64748B';
  }

  function relColor(rel) {
    return REL_COLORS[rel] || '#6C63FF';
  }

  // ── Init ────────────────────────────────────────────────────
  function init(container, clickCallback) {
    onNodeClick = clickCallback;
    const el = document.getElementById(container);
    width  = el.clientWidth  || 800;
    height = el.clientHeight || 600;

    svg = d3.select('#graph-svg')
      .attr('width', '100%')
      .attr('height', '100%');

    // Defs: arrowheads + glow filter
    const defs = svg.append('defs');

    // Glow filter for selected edge
    const glow = defs.append('filter').attr('id', 'edge-glow');
    glow.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'coloredBlur');
    const feMerge = glow.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    Object.entries(REL_COLORS).forEach(([rel, color]) => {
      defs.append('marker')
        .attr('id', `arrow-${rel}`)
        .attr('viewBox', '0 -4 8 8')
        .attr('refX', 18)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-4L8,0L0,4')
        .attr('fill', color)
        .attr('opacity', 0.6);

      // Active (selected) arrowhead — brighter
      defs.append('marker')
        .attr('id', `arrow-${rel}-active`)
        .attr('viewBox', '0 -4 8 8')
        .attr('refX', 18)
        .attr('refY', 0)
        .attr('markerWidth', 7)
        .attr('markerHeight', 7)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-4L8,0L0,4')
        .attr('fill', color)
        .attr('opacity', 1);
    });

    // Main group (for zoom)
    g = svg.append('g').attr('class', 'graph-root');

    // Layer groups — hit areas go ABOVE visible links
    g.append('g').attr('class', 'links-layer');
    g.append('g').attr('class', 'links-hit-layer');   // ← invisible click targets
    g.append('g').attr('class', 'nodes-layer');
    g.append('g').attr('class', 'labels-layer');

    // Zoom behaviour
    zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        currentTransform = event.transform;
        g.attr('transform', event.transform);
      });

    svg.call(zoom)
      .on('dblclick.zoom', null); // disable dblclick zoom

    // Simulation
    simulation = d3.forceSimulation()
      .force('link', d3.forceLink().id(d => d.id).distance(d => d.score >= 0.75 ? 90 : 160).strength(d => d.score * 0.6))
      .force('charge', d3.forceManyBody().strength(-280))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => nodeRadius(d) + 12));

    simulation.on('tick', ticked);

    // Zoom controls
    document.getElementById('btn-zoom-in').addEventListener('click', () => {
      svg.transition().duration(300).call(zoom.scaleBy, 1.4);
    });
    document.getElementById('btn-zoom-out').addEventListener('click', () => {
      svg.transition().duration(300).call(zoom.scaleBy, 0.7);
    });
    document.getElementById('btn-zoom-reset').addEventListener('click', () => {
      svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity);
    });

    // Window resize
    window.addEventListener('resize', () => {
      const el2 = document.getElementById(container);
      width  = el2.clientWidth;
      height = el2.clientHeight;
      simulation.force('center', d3.forceCenter(width / 2, height / 2));
      simulation.alpha(0.1).restart();
    });
  }

  // ── Helpers ──────────────────────────────────────────────────
  function nodeRadius(d) {
    const graph = GraphStore.getGraph();
    const deg = graph.edges.filter(e => e.source === d.id || e.target === d.id).length;
    return Math.max(10, Math.min(28, 10 + deg * 2.5));
  }

  // ── Render ───────────────────────────────────────────────────
  function render(graphData, options = {}) {
    showLabels    = options.showLabels   !== undefined ? options.showLabels   : true;
    showWeakLinks = options.showWeakLinks !== undefined ? options.showWeakLinks : true;

    // Merge positions from existing simulation nodes
    const existingById = {};
    nodes.forEach(n => { existingById[n.id] = { x: n.x, y: n.y, vx: n.vx, vy: n.vy }; });

    nodes = graphData.nodes.map(n => {
      const prev = existingById[n.id];
      return prev ? { ...n, ...prev } : { ...n, x: width/2 + (Math.random()-0.5)*120, y: height/2 + (Math.random()-0.5)*120 };
    });

    links = graphData.edges
      .filter(e => showWeakLinks || e.strength === 'strong' || e.relationship === 'CONTRADICTS')
      .map(e => ({ ...e }));

    // Update legend
    _renderLegend(graphData);

    // ── VISIBLE LINKS ──────────────────────────────────────────
    const linksLayer = g.select('.links-layer');
    const linkSel = linksLayer.selectAll('line.link').data(links, d => d.id);

    linkSel.enter()
      .append('line')
      .attr('class', d => `link ${d.strength || 'weak'} ${d.relationship === 'CONTRADICTS' ? 'contradiction' : ''}`)
      .attr('stroke', d => relColor(d.relationship))
      .attr('stroke-dasharray', d => d.strength === 'weak' ? '4 4' : null)
      .attr('marker-end', d => `url(#arrow-${d.relationship})`)
      .attr('stroke-width', 1.5)
      .attr('opacity', 0)
      .transition().duration(600)
      .attr('opacity', d => d.strength === 'weak' ? 0.25 : 0.55);

    linkSel.exit().transition().duration(300).attr('opacity', 0).remove();

    // ── HIT-AREA LINKS (invisible, fat, clickable) ──────────────
    const hitLayer = g.select('.links-hit-layer');
    const hitSel = hitLayer.selectAll('line.link-hit').data(links, d => d.id);

    hitSel.enter()
      .append('line')
      .attr('class', 'link-hit')
      .attr('stroke', 'transparent')
      .attr('stroke-width', 14)        // fat invisible hit area
      .attr('cursor', 'pointer')
      .on('mouseenter', function(event, d) {
        // Highlight visible counterpart
        linksLayer.selectAll('line.link')
          .filter(l => l.id === d.id)
          .attr('stroke-width', 3)
          .attr('opacity', 1);
        d3.select(this).attr('stroke', 'rgba(255,255,255,0.02)');
      })
      .on('mouseleave', function(event, d) {
        if (d.id !== selectedEdgeId) {
          linksLayer.selectAll('line.link')
            .filter(l => l.id === d.id)
            .attr('stroke-width', 1.5)
            .attr('opacity', d.strength === 'weak' ? 0.25 : 0.55);
        }
        d3.select(this).attr('stroke', 'transparent');
      })
      .on('click', (event, d) => {
        event.stopPropagation();
        _selectEdge(d.id);
        if (onEdgeClick) {
          // Resolve source/target to actual node objects
          const srcId  = typeof d.source === 'object' ? d.source.id : d.source;
          const tgtId  = typeof d.target === 'object' ? d.target.id : d.target;
          const srcNode = GraphStore.getNode(srcId);
          const tgtNode = GraphStore.getNode(tgtId);
          onEdgeClick(d, srcNode, tgtNode);
        }
      });

    hitSel.exit().remove();

    // ── NODES ──────────────────────────────────────────────────
    const nodesLayer = g.select('.nodes-layer');
    const nodeSel = nodesLayer.selectAll('g.node').data(nodes, d => d.id);

    const nodeEnter = nodeSel.enter()
      .append('g')
      .attr('class', 'node')
      .attr('data-id', d => d.id)
      .call(d3.drag()
        .on('start', dragStarted)
        .on('drag',  dragging)
        .on('end',   dragEnded)
      )
      .on('click', (event, d) => {
        event.stopPropagation();
        _selectEdge(null);   // deselect edge when node clicked
        selectNode(d.id);
        if (onNodeClick) onNodeClick(d);
      });

    nodeEnter.append('circle')
      .attr('r', 0)
      .attr('fill', d => domainColor(d.domain))
      .attr('stroke', d => domainColor(d.domain))
      .attr('stroke-opacity', 0.5)
      .attr('fill-opacity', 0.85)
      .transition().duration(500)
      .attr('r', d => nodeRadius(d))
      .ease(d3.easeBackOut.overshoot(1.4));

    // Glow filter on hover via CSS class
    nodeEnter.on('mouseenter', function(event, d) {
      d3.select(this).select('circle')
        .attr('stroke-width', 3)
        .attr('stroke-opacity', 1);
    }).on('mouseleave', function(event, d) {
      if (d.id !== selectedNodeId) {
        d3.select(this).select('circle')
          .attr('stroke-width', 2)
          .attr('stroke-opacity', 0.5);
      }
    });

    nodeSel.exit().transition().duration(300)
      .attr('opacity', 0).remove();

    // ── LABELS ─────────────────────────────────────────────────
    const labelsLayer = g.select('.labels-layer');
    const labelSel = labelsLayer.selectAll('text.node-label').data(nodes, d => d.id);

    labelSel.enter()
      .append('text')
      .attr('class', 'node-label')
      .attr('dy', d => nodeRadius(d) + 14)
      .attr('fill', '#94A3B8')
      .attr('font-size', '9px')
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('text-anchor', 'middle')
      .attr('pointer-events', 'none')
      .attr('opacity', 0)
      .text(d => truncate(d.title, 22))
      .transition().duration(500)
      .attr('opacity', showLabels ? 1 : 0);

    labelSel.exit().remove();

    // Click on background deselects
    svg.on('click', () => {
      selectNode(null);
      _selectEdge(null);
      if (onNodeClick) onNodeClick(null);
    });

    // Restart simulation
    simulation.nodes(nodes);
    simulation.force('link').links(links);
    simulation.alpha(0.35).restart();
  }

  function ticked() {
    // Update visible links
    g.select('.links-layer').selectAll('line.link')
      .attr('x1', d => (d.source && d.source.x) || 0)
      .attr('y1', d => (d.source && d.source.y) || 0)
      .attr('x2', d => (d.target && d.target.x) || 0)
      .attr('y2', d => (d.target && d.target.y) || 0);

    // Update hit-area lines to same positions
    g.select('.links-hit-layer').selectAll('line.link-hit')
      .attr('x1', d => (d.source && d.source.x) || 0)
      .attr('y1', d => (d.source && d.source.y) || 0)
      .attr('x2', d => (d.target && d.target.x) || 0)
      .attr('y2', d => (d.target && d.target.y) || 0);

    g.select('.nodes-layer').selectAll('g.node')
      .attr('transform', d => `translate(${d.x || 0},${d.y || 0})`);

    g.select('.labels-layer').selectAll('text.node-label')
      .attr('x', d => d.x || 0)
      .attr('y', d => d.y || 0);
  }

  // ── Drag ────────────────────────────────────────────────────
  function dragStarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x; d.fy = d.y;
  }
  function dragging(event, d) { d.fx = event.x; d.fy = event.y; }
  function dragEnded(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null; d.fy = null;
  }

  // ── Edge Selection ───────────────────────────────────────────
  function _selectEdge(id) {
    selectedEdgeId = id;
    g.select('.links-layer').selectAll('line.link').each(function(d) {
      const isActive = d.id === id;
      d3.select(this)
        .attr('stroke-width', isActive ? 3.5 : 1.5)
        .attr('opacity',      isActive ? 1.0 : (d.strength === 'weak' ? 0.25 : 0.55))
        .attr('filter',       isActive ? 'url(#edge-glow)' : null)
        .attr('stroke',       isActive ? '#ffffff' : relColor(d.relationship));
    });
  }

  // ── Node Selection ───────────────────────────────────────────
  function selectNode(id) {
    selectedNodeId = id;
    g.select('.nodes-layer').selectAll('g.node').each(function(d) {
      const isSelected = d.id === id;
      d3.select(this).select('circle')
        .attr('stroke-width', isSelected ? 3 : 2)
        .attr('stroke-opacity', isSelected ? 1 : 0.5)
        .attr('filter', isSelected ? 'brightness(1.4)' : null);
    });
  }

  function focusNode(id) {
    const node = nodes.find(n => n.id === id);
    if (!node) return;
    const x = -(node.x || 0) * currentTransform.k + width / 2;
    const y = -(node.y || 0) * currentTransform.k + height / 2;
    svg.transition().duration(500).call(
      zoom.transform,
      d3.zoomIdentity.translate(x, y).scale(currentTransform.k)
    );
    selectNode(id);
  }

  // ── Legend ───────────────────────────────────────────────────
  function _renderLegend(graphData) {
    const domains = [...new Set(graphData.nodes.map(n => n.domain))];
    const legend = document.getElementById('graph-legend');
    const items = domains.map(d =>
      `<div class="legend-item">
        <div class="legend-dot" style="background:${domainColor(d)}"></div>
        <span>${d}</span>
      </div>`
    ).join('');
    legend.innerHTML = `<div class="legend-title">Domains</div>${items}`;
  }

  // ── Helpers ──────────────────────────────────────────────────
  function truncate(str, n) {
    return str && str.length > n ? str.slice(0, n) + '…' : str;
  }

  function setShowLabels(v) {
    showLabels = v;
    g && g.select('.labels-layer').selectAll('text.node-label')
      .transition().duration(300).attr('opacity', v ? 1 : 0);
  }

  function setShowWeakLinks(v) {
    showWeakLinks = v;
  }

  function setOnEdgeClick(cb) {
    onEdgeClick = cb;
  }

  // ── Public API ───────────────────────────────────────────────
  return { init, render, focusNode, selectNode, setShowLabels, setShowWeakLinks, domainColor, relColor, setOnEdgeClick };
})();
