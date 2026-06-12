/* ============================================================
   promptLoop.js — 6-step LLM prompt pipeline with workspace context
   ============================================================ */

const PromptLoop = (() => {

  // ── Workspace context helper ────────────────────────────────
  function _wsContext() {
    const ws = GraphStore.getActiveWorkspace();
    if (!ws || !ws.context) return '';
    return `\nWORKSPACE CONTEXT: This is the user's "${ws.name}" graph. Focus area: ${ws.context}\nOnly create connections that are relevant within this context. Do NOT link unrelated domains.\n`;
  }

  // ── PROMPTS ──────────────────────────────────────────────────

  const PROMPTS = {

    // STEP 1: Capture & classify the thought
    capture: (rawThought, mediaType = 'text') => `You are a thought-capture system for a personal knowledge graph.
Your job is to receive raw, unstructured input and structure it for storage.
${_wsContext()}
INPUT TYPE: ${mediaType}
RAW INPUT:
"""
${rawThought}
"""

TASK:
1. Clean and expand the thought (add implied context, but stay faithful to intent).
2. Classify thought TYPE from: [idea, question, observation, plan, emotion, reference, random]
3. Extract KEY ENTITIES (people, concepts, places, projects, tools, dates). Max 8. Short nouns only.
4. Assign DOMAIN from: [philosophy, work, creativity, science, technology, personal, health, finance, education, random]
5. Assign EMOTIONAL WEIGHT from: [neutral, excited, anxious, curious, determined, melancholic, energized]
6. Create a SHORT TITLE (max 8 words) — evocative, not generic.

Respond ONLY with valid JSON. No markdown fences, no explanation.
{
  "title": "...",
  "cleaned_thought": "...",
  "type": "...",
  "domain": "...",
  "entities": ["...", "..."],
  "emotional_weight": "...",
  "raw": "${rawThought.replace(/"/g, '\\"').slice(0, 300)}"
}`,

    // STEP 2: Find connections to existing nodes (STRICT)
    link: (newNode, existingNodesSummary) => `You are a strict knowledge graph linker.
You ONLY create connections when there is genuine, verifiable overlap between ideas.
${_wsContext()}
NEW NODE:
Title: "${newNode.title}"
Thought: "${newNode.cleaned_thought}"
Domain: ${newNode.domain}
Entities: ${(newNode.entities || []).join(', ')}

EXISTING NODES (id | title | domain | type | entities):
${existingNodesSummary || '(no existing nodes)'}

STRICT CONNECTION RULES — ONLY create a link when AT LEAST ONE of these is true:
1. ENTITY OVERLAP: They share ≥1 specific entity (person, tool, project, concept) — not a vague category
2. LOGICAL DEPENDENCY: One idea logically requires, extends, or constrains the other
3. DIRECT CONTRADICTION: They reach opposite conclusions about the SAME specific topic
4. CAUSAL CHAIN: A concrete, traceable chain of cause/effect connects them (not "both relate to X")

DO NOT LINK if the only connection is:
- Sharing a broad domain (e.g. both are "about technology")
- Vague thematic similarity (e.g. "both involve thinking")
- Same emotional tone
- Same type (e.g. both are questions)

RELATIONSHIP TYPES: BUILDS_ON, CONTRADICTS, SUPPORTS, PART_OF, LEADS_TO, OVERLAPS, TRIGGERED_BY, ELABORATES

LIMITS:
- Maximum 3 strong_links (score 0.80–1.0)
- Maximum 2 weak_links (score 0.60–0.79)
- If no genuine connection exists, return EMPTY arrays. This is PREFERRED over forced links.
- Each link MUST include a "shared_entities" array listing the specific entities that justify it.

Respond ONLY with valid JSON. No markdown fences.
{
  "strong_links": [
    {"node_id": "...", "relationship": "...", "score": 0.85, "reason": "specific explanation of the connection", "shared_entities": ["entity1"]}
  ],
  "weak_links": [
    {"node_id": "...", "relationship": "...", "score": 0.65, "reason": "specific explanation", "shared_entities": ["entity1"]}
  ],
  "contradictions": [
    {"node_id": "...", "tension": "one sentence describing the specific tension"}
  ]
}`,

    // STEP 3: Dynamic cluster regrouping
    cluster: (allNodesSummary) => `You are a cognitive clustering engine for a personal knowledge graph.
Analyze the entire graph and group thoughts into meaningful thematic clusters.
${_wsContext()}
ALL NODES (id | title | domain | type | entities | current cluster):
${allNodesSummary}

TASK:
1. Identify 2–8 THEMATIC CLUSTERS that emerge from the data.
2. Give each cluster a short, evocative name (max 4 words).
3. List which node IDs belong to each cluster.
4. Identify ORPHAN NODES (no clear cluster — list their IDs).
5. Identify BRIDGE NODES (nodes that connect multiple clusters).
6. Score cluster DENSITY 0–1 (how tightly related are nodes within the cluster).
7. Suggest a hex color for each cluster.

Respond ONLY with valid JSON. No markdown fences.
{
  "clusters": [
    {
      "id": "cluster_1",
      "name": "Creative Exploration",
      "node_ids": ["n_xxx", "n_yyy"],
      "density": 0.75,
      "color": "#6C63FF"
    }
  ],
  "orphans": ["n_zzz"],
  "bridges": [
    {"node_id": "n_xxx", "connects_clusters": ["cluster_1", "cluster_2"], "importance": "high"}
  ]
}`,

    // STEP 4: Weekly reflection & synthesis
    reflect: (graphSummary, dateRange) => `You are a reflective intelligence layer analyzing a personal knowledge graph.
Your job is to surface deep insights, patterns, and blind spots from the user's captured thoughts.
${_wsContext()}
GRAPH SUMMARY (most recent and most-accessed nodes):
${graphSummary}

TIME RANGE: ${dateRange || 'all time'}

TASK:
1. Identify TOP 3 EMERGING THEMES.
2. Detect RECURRING TENSIONS (pairs of ideas that keep contradicting or creating friction).
3. Surface DORMANT IDEAS (node IDs that seem important but are disconnected or under-explored).
4. Generate 3 SYNTHESIS QUESTIONS — deep, non-obvious questions that would bridge major gaps.
5. Suggest 1 "NEXT ACTION" — the single most valuable thought/action to add to the graph right now.
6. Write a SHORT NARRATIVE (2-3 sentences) about the state of the user's mental model.

Be specific, insightful, and poetic. Avoid generic platitudes.
Respond ONLY with valid JSON. No markdown fences.
{
  "emerging_themes": ["...", "...", "..."],
  "recurring_tensions": [
    {"theme_a": "...", "theme_b": "...", "tension": "..."}
  ],
  "dormant_ideas": ["node_id_1", "node_id_2"],
  "synthesis_questions": ["...", "...", "..."],
  "next_action": "...",
  "narrative": "..."
}`,

    // STEP 5: Query / surface from graph
    surface: (query, subgraphContext) => `You are a memory retrieval system for a personal knowledge graph.
Help the user recall, explore, and expand their thinking based on a query.
${_wsContext()}
USER QUERY: "${query}"

RELEVANT GRAPH CONTEXT:
${subgraphContext}

TASK:
1. Find the MOST RELEVANT nodes to this query and explain why.
2. Trace a PATH OF THOUGHT: how ideas connect to answer or explore this query.
3. Suggest WHAT'S MISSING: perspectives or thoughts not yet in the graph.
4. Generate a FOLLOW-UP QUESTION to push thinking further.

Respond ONLY with valid JSON. No markdown fences.
{
  "relevant_nodes": [{"id": "...", "relevance_reason": "..."}],
  "thought_path": ["node_id_1 → node_id_2: connecting reason"],
  "missing_perspectives": ["...", "..."],
  "follow_up_question": "..."
}`,

    // STEP 6: Connection Reasoner — purely technical analysis
    connectionReason: (nodeA, nodeB, relationship, edgeReason) => `You are a technical reasoning engine.
Your job is to perform a rigorous, purely technical analysis of the connection between two ideas.
No metaphors. No poetry. No vague generalities. Only precise, structural, logical reasoning.

NODE A:
  Title: "${nodeA.title}"
  Content: "${nodeA.cleaned_thought || nodeA.raw || ''}"
  Domain: ${nodeA.domain} | Type: ${nodeA.type}
  Entities: ${(nodeA.entities || []).join(', ')}

NODE B:
  Title: "${nodeB.title}"
  Content: "${nodeB.cleaned_thought || nodeB.raw || ''}"
  Domain: ${nodeB.domain} | Type: ${nodeB.type}
  Entities: ${(nodeB.entities || []).join(', ')}

DECLARED RELATIONSHIP: ${relationship}
INITIAL LINK REASON: "${edgeReason || 'not specified'}"

PRODUCE A TECHNICAL ANALYSIS across these 7 dimensions:

1. SHARED_ABSTRACTIONS — What common abstract concepts, structures, or formal objects do both ideas operate on? Name the specific abstractions (e.g. "both operate on finite state machines", "both involve gradient descent over a loss surface").

2. LOGICAL_DEPENDENCY — State the precise logical relationship: Does A entail B? Does B constrain A? Are they co-dependent? Is this a necessary or contingent dependency? Write as a formal statement if possible.

3. CAUSAL_MECHANISM — What is the actual mechanism that produces the link? Identify the chain of causation or inference steps connecting A to B. Be specific about intermediate steps.

4. INFORMATION_OVERLAP — What specific information, variables, or propositions must be known in A to derive or understand B? State the overlap as a set of shared knowns.

5. STRUCTURAL_ISOMORPHISM — Do A and B share the same underlying formal structure, pattern, or schema when abstracted? If yes, describe the mapping. If no, state why the structures diverge.

6. DIVERGENCE_POINT — At exactly which assumption, axiom, variable, or scope boundary do A and B separate? Be precise.

7. SYNTHESIS_VECTOR — What new, technically specific idea, question, or hypothesis emerges at the intersection of A and B that neither contains alone?

Respond ONLY with valid JSON. No markdown fences. No prose outside the JSON.
{
  "shared_abstractions": ["...", "..."],
  "logical_dependency": "...",
  "causal_mechanism": "...",
  "information_overlap": ["...", "..."],
  "structural_isomorphism": "...",
  "divergence_point": "...",
  "synthesis_vector": "...",
  "one_line_summary": "..."
}`,
  };

  // ── API CALL ─────────────────────────────────────────────────

  async function callLLM(prompt, imageBase64 = null) {
    const settings = GraphStore.loadSettings();
    const { provider, apiKey, model, ollamaUrl, ollamaModel } = settings;

    if (!apiKey && provider !== 'ollama') {
      throw new Error('No API key configured. Please open Settings and add your API key.');
    }

    const messages = [{ role: 'user', content: prompt }];

    // Add image if provided (vision)
    if (imageBase64 && provider === 'openai') {
      messages[0].content = [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
      ];
    }

    // OpenAI
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || 'gpt-4o',
          messages,
          temperature: 0.4,
          max_tokens: 1200,
          response_format: { type: 'json_object' },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `OpenAI error ${res.status}`);
      }
      const data = await res.json();
      return data.choices[0].message.content;
    }

    // Anthropic
    if (provider === 'anthropic') {
      const body = {
        model: model || 'claude-3-5-sonnet-20241022',
        max_tokens: 1200,
        messages,
      };
      if (imageBase64) {
        body.messages[0].content = [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: prompt },
        ];
      }
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Anthropic error ${res.status}`);
      }
      const data = await res.json();
      return data.content[0].text;
    }

    // Google Gemini
    if (provider === 'google') {
      const geminiModel = model || 'gemini-2.0-flash';
      const parts = [{ text: prompt }];
      if (imageBase64) {
        parts.unshift({ inline_data: { mime_type: 'image/jpeg', data: imageBase64 } });
      }
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Gemini error ${res.status}`);
      }
      const data = await res.json();
      return data.candidates[0].content.parts[0].text;
    }

    // DeepSeek (OpenAI-compatible)
    if (provider === 'deepseek') {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || 'deepseek-chat',
          messages,
          temperature: 0.4,
          max_tokens: 1200,
          response_format: { type: 'json_object' },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `DeepSeek error ${res.status}`);
      }
      const data = await res.json();
      return data.choices[0].message.content;
    }

    // Ollama (local)
    if (provider === 'ollama') {
      const res = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ollamaModel || 'llama3.2',
          prompt,
          stream: false,
          format: 'json',
          options: { temperature: 0.4 },
        }),
      });
      if (!res.ok) throw new Error(`Ollama error ${res.status}`);
      const data = await res.json();
      return data.response;
    }

    throw new Error('Unknown provider: ' + provider);
  }

  function parseJSON(str) {
    // Strip markdown fences if model ignored instruction
    str = str.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    return JSON.parse(str);
  }

  // ── PIPELINE STEPS ───────────────────────────────────────────

  // Step 1: Capture
  async function stepCapture(rawText, mediaType = 'text', imageBase64 = null) {
    const prompt = PROMPTS.capture(rawText, mediaType);
    const raw = await callLLM(prompt, imageBase64);
    return parseJSON(raw);
  }

  // Step 2: Link (with client-side entity overlap filter)
  async function stepLink(newNode, maxExisting = 50) {
    const nodes = GraphStore.getNodes();
    if (nodes.length === 0) return { strong_links: [], weak_links: [], contradictions: [] };

    const others = nodes
      .filter(n => n.id !== newNode.id)
      .slice(-maxExisting);

    const summary = others.map(n =>
      `${n.id} | "${n.title}" | ${n.domain} | ${n.type} | ${(n.entities || []).join(',')}`
    ).join('\n');

    const prompt = PROMPTS.link(newNode, summary);
    const raw = await callLLM(prompt);
    const result = parseJSON(raw);

    // ── Client-side quality filter ──────────────────────────
    const newEntities = new Set((newNode.entities || []).map(e => e.toLowerCase()));

    function hasEntityOverlap(link) {
      // Check shared_entities from LLM
      if (link.shared_entities && link.shared_entities.length > 0) return true;
      // Fallback: check actual entity overlap with target node
      const target = GraphStore.getNode(link.node_id);
      if (!target) return false;
      const targetEntities = (target.entities || []).map(e => e.toLowerCase());
      return targetEntities.some(e => newEntities.has(e));
    }

    // Filter strong links
    result.strong_links = (result.strong_links || [])
      .filter(l => l.score >= 0.80)
      .filter(l => l.reason && l.reason.length >= 10)
      .slice(0, 3);  // cap at 3

    // Filter weak links — require entity overlap for OVERLAPS relationship
    result.weak_links = (result.weak_links || [])
      .filter(l => l.score >= 0.60)
      .filter(l => l.reason && l.reason.length >= 10)
      .filter(l => {
        if (l.relationship === 'OVERLAPS') return hasEntityOverlap(l);
        return true;
      })
      .slice(0, 2);  // cap at 2

    return result;
  }

  // Step 3: Cluster
  async function stepCluster() {
    const nodes = GraphStore.getNodes();
    if (nodes.length < 2) return { clusters: [], orphans: [], bridges: [] };

    const summary = nodes.map(n =>
      `${n.id} | "${n.title}" | ${n.domain} | ${n.type} | ${(n.entities || []).join(',')} | ${n.cluster || 'none'}`
    ).join('\n');

    const prompt = PROMPTS.cluster(summary);
    const raw = await callLLM(prompt);
    return parseJSON(raw);
  }

  // Step 4: Reflect
  async function stepReflect() {
    const summary = GraphStore.getGraphSummary(60);
    const now = new Date().toLocaleDateString();
    const prompt = PROMPTS.reflect(summary, `up to ${now}`);
    const raw = await callLLM(prompt);
    return parseJSON(raw);
  }

  // Step 5: Surface / query
  async function stepSurface(query) {
    const context = GraphStore.getGraphSummary(30);
    const prompt = PROMPTS.surface(query, context);
    const raw = await callLLM(prompt);
    return parseJSON(raw);
  }

  // Step 6: Connection Reasoner
  async function stepConnectionReason(nodeA, nodeB, edge) {
    if (!nodeA || !nodeB) throw new Error('Both nodes required for connection reasoning');
    const prompt = PROMPTS.connectionReason(
      nodeA, nodeB,
      edge.relationship || 'OVERLAPS',
      edge.reason || ''
    );
    const raw = await callLLM(prompt);
    return parseJSON(raw);
  }

  // ── MAIN PIPELINE: Capture → Link → Cluster ──────────────────

  async function processThought(rawText, options = {}) {
    const {
      mediaType = 'text',
      imageBase64 = null,
      onStep = () => {},
    } = options;

    // Step 1
    onStep(1, 'active');
    let nodeData;
    try {
      nodeData = await stepCapture(rawText, mediaType, imageBase64);
      onStep(1, 'done');
    } catch (e) {
      onStep(1, 'error');
      throw e;
    }

    // Save node
    nodeData.raw = rawText;
    const node = GraphStore.addNode(nodeData);

    // Step 2
    onStep(2, 'active');
    let linkData;
    try {
      linkData = await stepLink(node);
      onStep(2, 'done');
    } catch (e) {
      onStep(2, 'error');
      linkData = { strong_links: [], weak_links: [], contradictions: [] };
    }

    // Persist edges (quality gate is now inside addEdge + stepLink filter)
    (linkData.strong_links || []).forEach(l => {
      if (GraphStore.getNode(l.node_id)) {
        GraphStore.addEdge({
          source: node.id, target: l.node_id,
          relationship: l.relationship, score: l.score, reason: l.reason,
        });
      }
    });
    (linkData.weak_links || []).forEach(l => {
      if (GraphStore.getNode(l.node_id)) {
        GraphStore.addEdge({
          source: node.id, target: l.node_id,
          relationship: l.relationship, score: l.score, reason: l.reason,
        });
      }
    });
    (linkData.contradictions || []).forEach(c => {
      if (GraphStore.getNode(c.node_id)) {
        GraphStore.addContradiction(node.id, c.node_id, c.tension);
      }
    });

    // Step 3
    onStep(3, 'active');
    let clusterData;
    try {
      clusterData = await stepCluster();
      onStep(3, 'done');
    } catch (e) {
      onStep(3, 'error');
      clusterData = { clusters: [], orphans: [], bridges: [] };
    }

    if (clusterData.clusters && clusterData.clusters.length > 0) {
      GraphStore.setClusters(clusterData.clusters);
    }

    return { node, linkData, clusterData };
  }

  // ── Public API ───────────────────────────────────────────────
  return {
    processThought,
    stepCapture,
    stepLink,
    stepCluster,
    stepReflect,
    stepSurface,
    stepConnectionReason,
    PROMPTS,
  };
})();
