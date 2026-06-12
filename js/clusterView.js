/* ============================================================
   clusterView.js — D3.js bubble cluster map
   ============================================================ */

const ClusterView = (() => {

  let svg, g, zoom;
  let width = 800, height = 600;
  let onNodeClick = null;

  const DEFAULT_COLORS = [
    '#6C63FF','#3B82F6','#EC4899','#10B981',
    '#F59E0B','#06B6D4','#8B5CF6','#F97316',
  ];

  function init(clickCallback) {
    onNodeClick = clickCallback;
    const el = document.getElementById('cluster-view');
    width  = el.clientWidth  || 800;
    height = el.clientHeight || 600;

    svg = d3.select('#cluster-svg')
      .attr('width', '100%')
      .attr('height', '100%');

    g = svg.append('g').attr('class', 'cluster-root');

    zoom = d3.zoom()
      .scaleExtent([0.3, 3])
      .on('zoom', event => g.attr('transform', event.transform));

    svg.call(zoom).on('dblclick.zoom', null);

    window.addEventListener('resize', () => {
      const el2 = document.getElementById('cluster-view');
      width  = el2.clientWidth;
      height = el2.clientHeight;
    });
  }

  function render(graphData) {
    g.selectAll('*').remove();

    const clusters = graphData.clusters;
    const nodes    = graphData.nodes;

    if (!clusters || clusters.length === 0) {
      _renderOrphans(nodes);
      return;
    }

    // Build hierarchical data for d3.pack
    const rootData = {
      id: 'root',
      children: clusters.map((cl, ci) => {
        const clNodes = (cl.node_ids || [])
          .map(nid => nodes.find(n => n.id === nid))
          .filter(Boolean);
        return {
          id: cl.id,
          name: cl.name,
          color: cl.color || DEFAULT_COLORS[ci % DEFAULT_COLORS.length],
          density: cl.density || 0.5,
          children: clNodes.map(n => ({
            id: n.id,
            name: n.title,
            node: n,
            value: 1 + (n.accessCount || 0),
          })),
        };
      }),
    };

    // Add orphans as their own loose cluster
    const orphanIds = new Set(graphData.clusters.flatMap(c => c.node_ids || []));
    const orphanNodes = nodes.filter(n => !orphanIds.has(n.id));
    if (orphanNodes.length > 0) {
      rootData.children.push({
        id: 'orphans',
        name: 'Unclustered',
        color: '#475569',
        density: 0,
        children: orphanNodes.map(n => ({
          id: n.id, name: n.title, node: n, value: 1,
        })),
      });
    }

    const root = d3.hierarchy(rootData)
      .sum(d => d.value || 0)
      .sort((a, b) => b.value - a.value);

    const pack = d3.pack()
      .size([width - 80, height - 80])
      .padding(20);

    pack(root);

    // Translate root children to fill space
    const clusterGroups = g.selectAll('g.cl-group')
      .data(root.children)
      .enter()
      .append('g')
      .attr('class', 'cl-group')
      .attr('transform', d => `translate(${d.x + 40},${d.y + 40})`);

    // Cluster background bubble
    clusterGroups.append('circle')
      .attr('class', 'cluster-bubble')
      .attr('r', 0)
      .attr('fill', d => d.data.color)
      .attr('fill-opacity', d => 0.08 + (d.data.density || 0) * 0.12)
      .attr('stroke', d => d.data.color)
      .attr('stroke-opacity', 0.35)
      .attr('stroke-width', 1.5)
      .transition().duration(700)
      .attr('r', d => d.r)
      .ease(d3.easeBackOut.overshoot(1.2));

    // Cluster label
    clusterGroups.append('text')
      .attr('class', 'cluster-label')
      .attr('y', d => -d.r + 20)
      .attr('fill', d => d.data.color)
      .attr('font-size', d => Math.max(9, Math.min(15, d.r / 5)))
      .attr('font-family', 'Inter, sans-serif')
      .attr('font-weight', '600')
      .attr('text-anchor', 'middle')
      .attr('opacity', 0)
      .text(d => d.data.name)
      .transition().delay(400).duration(400)
      .attr('opacity', 0.9);

    // Density indicator ring
    clusterGroups.filter(d => d.data.density > 0.5)
      .append('circle')
      .attr('r', d => d.r - 6)
      .attr('fill', 'none')
      .attr('stroke', d => d.data.color)
      .attr('stroke-opacity', 0.15)
      .attr('stroke-dasharray', '4 6');

    // Node sub-bubbles inside each cluster
    const nodeGroups = clusterGroups.selectAll('g.cl-node')
      .data(d => d.children || [])
      .enter()
      .append('g')
      .attr('class', 'cl-node')
      .attr('transform', d => `translate(${d.x - d.parent.x},${d.y - d.parent.y})`)
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation();
        if (onNodeClick && d.data.node) onNodeClick(d.data.node);
      });

    nodeGroups.append('circle')
      .attr('class', 'cluster-node-bubble')
      .attr('r', 0)
      .attr('fill', d => d.parent.data.color)
      .attr('fill-opacity', 0.65)
      .attr('stroke', d => d.parent.data.color)
      .attr('stroke-opacity', 0.5)
      .attr('stroke-width', 1)
      .transition().delay((d, i) => 200 + i * 40).duration(400)
      .attr('r', d => Math.max(4, d.r))
      .ease(d3.easeBackOut);

    nodeGroups.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-size', d => Math.max(6, Math.min(10, d.r * 0.65)))
      .attr('fill', 'white')
      .attr('opacity', 0)
      .attr('pointer-events', 'none')
      .text(d => d.r > 12 ? _truncate(d.data.name, 12) : '')
      .transition().delay(600).duration(300)
      .attr('opacity', 0.85);

    // Tooltip on hover
    nodeGroups.append('title')
      .text(d => d.data.name);

    // Bridge nodes: draw a faint arc connecting clusters (simplified)
    _renderBridges(root, graphData.clusters);
  }

  function _renderBridges(root, clusters) {
    // Find bridge nodes from cluster data
    const bridges = clusters.filter(c => c.bridges).flatMap(c => c.bridges || []);
    if (bridges.length === 0) return;

    const clusterById = {};
    (root.children || []).forEach(d => { clusterById[d.data.id] = d; });

    bridges.forEach(bridge => {
      const connects = bridge.connects_clusters || [];
      if (connects.length < 2) return;
      const c1 = clusterById[connects[0]];
      const c2 = clusterById[connects[1]];
      if (!c1 || !c2) return;

      g.append('line')
        .attr('x1', c1.x + 40).attr('y1', c1.y + 40)
        .attr('x2', c2.x + 40).attr('y2', c2.y + 40)
        .attr('stroke', '#A78BFA')
        .attr('stroke-opacity', 0.15)
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '4 6');
    });
  }

  function _renderOrphans(nodes) {
    if (!nodes || nodes.length === 0) return;
    const pack = d3.pack().size([width - 80, height - 80]).padding(8);
    const root = d3.hierarchy({ children: nodes.map((n, i) => ({ id: n.id, name: n.title, node: n, value: 1 })) })
      .sum(d => d.value || 0);
    pack(root);

    g.selectAll('g.orphan-node')
      .data(root.children || [])
      .enter()
      .append('g')
      .attr('class', 'orphan-node')
      .attr('transform', d => `translate(${d.x + 40},${d.y + 40})`)
      .call(sel => {
        sel.append('circle')
          .attr('r', d => d.r)
          .attr('fill', '#475569')
          .attr('fill-opacity', 0.5)
          .attr('stroke', '#64748B')
          .attr('stroke-opacity', 0.4);
        sel.append('text')
          .attr('text-anchor', 'middle')
          .attr('dy', '0.35em')
          .attr('font-size', d => Math.max(7, Math.min(11, d.r * 0.6)))
          .attr('fill', 'white')
          .attr('opacity', 0.7)
          .text(d => _truncate(d.data.name, 14));
      });
  }

  function resetZoom() {
    svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity);
  }

  function _truncate(str, n) {
    return str && str.length > n ? str.slice(0, n) + '…' : str;
  }

  return { init, render, resetZoom };
})();
