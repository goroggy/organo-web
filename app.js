const state = {
  data: null,
  index: 0,
  playback: null,
  deliveryExpanded: false,
  filter: "all",
  visibleIndices: []
};

const labels = {
  government: "",
  task_owner: "Közfeladat felelőse",
  delivery_body: "Irányított szakmai szerv",
  persisted: "változatlan",
  renamed: "átnevezve",
  appeared: "új az útvonalon"
};

const hungarianMonths = [
  "január", "február", "március", "április", "május", "június",
  "július", "augusztus", "szeptember", "október", "november", "december"
];

function formatHungarianDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return `${year}. ${hungarianMonths[month - 1]} ${day}.`;
}

function isStructuralSnapshot(snapshot, index) {
  if (index === 0 || snapshot.events.length) return true;
  return ["appeared_pirs", "renamed_pirs", "disappeared_pirs"]
    .some(field => snapshot.changes[field].length > 0);
}

function filteredSnapshotIndices() {
  return state.data.snapshots
    .map((snapshot, index) => ({snapshot, index}))
    .filter(({snapshot, index}) => state.filter === "all" || isStructuralSnapshot(snapshot, index))
    .map(({index}) => index);
}

const roleCaption = (node) => labels[node.role] || "";
const nodeSubtitle = (node) => [`PIR ${node.pir}`, roleCaption(node)].filter(Boolean).join(" · ");

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function sourceMarkup(source) {
  const label = escapeHtml(source);
  return /^https?:\/\//.test(source || "")
    ? `<a href="${label}" target="_blank" rel="noreferrer">Forrás megnyitása</a>`
    : `<div class="source-path">${label}</div>`;
}

function evidenceMarkup(items) {
  return items.map(item => `
    <article class="evidence-item">
      <strong>${escapeHtml(item.reference)}</strong>
      ${item.effective_date ? `<div class="field-label">Hatály / érvényesség</div><div>${escapeHtml(item.effective_date)}</div>` : ""}
      <p>${escapeHtml(item.excerpt)}</p>
      ${sourceMarkup(item.source_path)}
    </article>`).join("");
}

function showDetails(title, subtitle, items, evidenceState = "verified") {
  document.getElementById("details-title").textContent = title;
  document.getElementById("details-body").innerHTML = `
    ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
    <span class="state ${evidenceState}">${evidenceState === "needs_review" ? "Időeltérés – ellenőrzendő" : "Forrással igazolt"}</span>
    ${evidenceMarkup(items)}`;
}

function nodeButton(node) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `org-node ${node.diff}`;
  button.dataset.nodeId = node.id;
  const role = roleCaption(node);
  button.innerHTML = `
    <span class="node-top">${role ? `<span class="node-role">${role}</span>` : ""}<span class="node-diff">${labels[node.diff]}</span></span>
    <span class="node-name">${escapeHtml(node.name)}</span>
    <span class="node-pir">PIR ${escapeHtml(node.pir)}</span>`;
  button.addEventListener("click", () => {
    state.playback?.pause();
    showDetails(node.name, nodeSubtitle(node), node.evidence);
  });
  return button;
}

function edgeButton(edge) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `edge-button ${edge.evidence_state}`;
  button.setAttribute("aria-label", `${edge.label} kapcsolat bizonyítékának megnyitása`);
  button.innerHTML = `<span class="edge-line" aria-hidden="true"></span><span class="edge-label">${escapeHtml(edge.label)}</span>`;
  button.addEventListener("click", () => {
    state.playback?.pause();
    showDetails(edge.label, "Szervezetek közötti, dátumozott állítás", edge.evidence, edge.evidence_state);
  });
  return button;
}

function renderChanges(snapshot) {
  const container = document.getElementById("changes");
  const changes = [];
  snapshot.changes.renamed_pirs.forEach(pir => changes.push(`<span class="change">Átnevezve · ${pir}</span>`));
  snapshot.changes.appeared_pirs.forEach(pir => changes.push(`<span class="change appeared">Megjelent · ${pir}</span>`));
  snapshot.changes.disappeared_pirs.forEach(pir => changes.push(`<span class="change disappeared">Kikerült · ${pir}</span>`));
  container.innerHTML = changes.join("") || '<span class="change">Első vizsgált állapot</span>';
}

function renderGraph(snapshot) {
  const graph = document.getElementById("graph");
  graph.replaceChildren();
  const edgeByPair = new Map(snapshot.edges.map(edge => [`${edge.source}|${edge.target}`, edge]));

  if (snapshot.events.length) {
    const events = document.createElement("div");
    events.className = "succession-events";
    snapshot.events.forEach(event => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "succession-event";
      button.innerHTML = `
        <span class="event-label">Jogutódlás</span>
        <span class="event-flow">
          <span class="event-org"><small>Jogelőd</small><strong>${escapeHtml(event.source_name)}</strong><em>PIR ${escapeHtml(event.source_pir)}</em></span>
          <i class="event-arrow" aria-hidden="true">→</i>
          <span class="event-org"><small>Jogutód</small><strong>${escapeHtml(event.target_name)}</strong><em>PIR ${escapeHtml(event.target_pir)}</em></span>
        </span>`;
      button.addEventListener("click", () => {
        state.playback?.pause();
        showDetails(
          "Jogutódlás",
          `${event.source_name} (PIR ${event.source_pir}) → ${event.target_name} (PIR ${event.target_pir})`,
          event.evidence,
          event.evidence_state
        );
      });
      events.appendChild(button);
    });
    graph.appendChild(events);
  }

  const trunk = document.createElement("div");
  trunk.className = "graph-trunk";
  snapshot.task_path.forEach((nodeId, index) => {
    const node = snapshot.nodes.find(item => item.id === nodeId);
    trunk.appendChild(nodeButton(node));
    const next = snapshot.task_path[index + 1];
    if (next) trunk.appendChild(edgeButton(edgeByPair.get(`${nodeId}|${next}`)));
  });
  graph.appendChild(trunk);

  const ownerId = snapshot.task_path.at(-1);
  const deliveryEdges = snapshot.delivery_body_ids
    .map(nodeId => edgeByPair.get(`${ownerId}|${nodeId}`))
    .filter(Boolean);
  if (deliveryEdges.length) {
    const sharedEdge = {...deliveryEdges[0], label: `irányítás · ${deliveryEdges.length} szerv`};
    const edge = edgeButton(sharedEdge);
    edge.classList.add("group-edge");
    graph.appendChild(edge);
  }

  const group = document.createElement("section");
  group.className = "delivery-group";
  group.setAttribute("aria-label", "Nemzeti park igazgatóságok");
  group.classList.toggle("expanded", state.deliveryExpanded);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "delivery-toggle";
  toggle.setAttribute("aria-expanded", String(state.deliveryExpanded));
  toggle.innerHTML = `
    <span><strong>Nemzeti park igazgatóságok</strong><small>${snapshot.delivery_body_ids.length} irányított szervezet</small></span>
    <span class="toggle-action">${state.deliveryExpanded ? "Összecsukás" : "Mind megnyitása"} ${state.deliveryExpanded ? "↑" : "↓"}</span>`;
  toggle.addEventListener("click", () => {
    state.playback?.pause();
    state.deliveryExpanded = !state.deliveryExpanded;
    renderGraph(snapshot);
  });
  group.appendChild(toggle);
  const grid = document.createElement("div");
  grid.className = "delivery-grid";
  grid.hidden = !state.deliveryExpanded;
  snapshot.delivery_body_ids.forEach(nodeId => {
    const node = snapshot.nodes.find(item => item.id === nodeId);
    grid.appendChild(nodeButton(node));
  });
  group.appendChild(grid);
  graph.appendChild(group);
}

function animateSnapshot() {
  for (const element of [document.getElementById("graph"), document.getElementById("changes")]) {
    element.classList.remove("snapshot-transition");
    void element.offsetWidth;
    element.classList.add("snapshot-transition");
  }
}

function renderSnapshot(index, {animate = false} = {}) {
  state.index = index;
  const snapshot = state.data.snapshots[index];
  let activeTab = null;
  document.querySelectorAll(".snapshot-tab").forEach(button => {
    const selected = Number(button.dataset.snapshotIndex) === index;
    button.setAttribute("aria-selected", String(selected));
    if (selected) activeTab = button;
  });
  activeTab?.scrollIntoView({block: "nearest", inline: "nearest"});
  document.getElementById("snapshot-date").textContent = formatHungarianDate(snapshot.date);
  document.getElementById("snapshot-title").textContent = snapshot.title;
  document.getElementById("narrative").textContent = snapshot.narrative;
  document.getElementById("story-narrative").textContent = snapshot.narrative;
  const position = Math.max(0, state.visibleIndices.indexOf(index));
  document.getElementById("previous-snapshot").disabled = position === 0;
  document.getElementById("next-snapshot").disabled = position === state.visibleIndices.length - 1;
  document.getElementById("playback-progress").textContent = `${position + 1} / ${state.visibleIndices.length} · ${snapshot.date}`;
  renderChanges(snapshot);
  renderGraph(snapshot);
  if (animate) animateSnapshot();
  showDetails(
    "A közfeladat kijelölt felelőse",
    snapshot.nodes.find(node => node.id === snapshot.task_assignment.organisation_id).name,
    snapshot.task_assignment.evidence,
    snapshot.task_assignment.evidence_state
  );
  document.getElementById("live-status").textContent = `${snapshot.date} snapshot betöltve`;
}

function renderTabs() {
  const tabs = document.getElementById("snapshot-tabs");
  tabs.replaceChildren();
  state.visibleIndices.forEach((index, position) => {
    const snapshot = state.data.snapshots[index];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "snapshot-tab";
    button.dataset.snapshotIndex = index;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-label", snapshot.date);
    button.setAttribute("aria-selected", String(index === state.index));
    button.innerHTML = `<span class="snapshot-tab-date">${formatHungarianDate(snapshot.date)}</span><span class="snapshot-tab-title">${escapeHtml(snapshot.title)}</span>`;
    button.addEventListener("click", () => state.playback.select(position));
    tabs.appendChild(button);
  });
}

function wirePlayback() {
  const toggle = document.getElementById("playback-toggle");
  const setPlaying = playing => {
      document.body.classList.toggle("is-playing", playing);
      if (playing && state.deliveryExpanded) {
        state.deliveryExpanded = false;
        renderGraph(state.data.snapshots[state.index]);
      }
      toggle.setAttribute("aria-pressed", String(playing));
      toggle.textContent = playing ? "⏸ Szünet" : "▶ Lejátszás";
      document.getElementById("live-status").textContent = playing ? "A történet lejátszása elindult" : "A történet lejátszása megállt";
  };
  const createController = actualIndex => {
    let initialPosition = 0;
    state.visibleIndices.forEach((index, position) => {
      if (index <= actualIndex) initialPosition = position;
    });
    state.playback = window.ORGANO_PLAYBACK.createPlaybackController({
      length: state.visibleIndices.length,
      initialIndex: initialPosition,
      delayMs: 4500,
      onIndex: (position, animate) => renderSnapshot(state.visibleIndices[position], {animate}),
      onPlaying: setPlaying,
    });
    return state.visibleIndices[initialPosition];
  };

  state.visibleIndices = filteredSnapshotIndices();
  renderTabs();
  createController(state.index);
  toggle.addEventListener("click", () => state.playback.toggle());
  document.getElementById("previous-snapshot").addEventListener("click", () => state.playback.previous());
  document.getElementById("next-snapshot").addEventListener("click", () => state.playback.next());
  document.getElementById("snapshot-filter").addEventListener("change", event => {
    state.playback.pause();
    state.filter = event.target.value;
    state.visibleIndices = filteredSnapshotIndices();
    renderTabs();
    const selectedIndex = createController(state.index);
    renderSnapshot(selectedIndex);
  });
}

function showDirectoryItem(item) {
  const snapshot = state.data.snapshots[state.index];
  const visible = snapshot.nodes.find(node => node.pir === item.pir);
  if (visible) {
    document.querySelector(`[data-node-id="${visible.id}"]`)?.focus();
    showDetails(visible.name, nodeSubtitle(visible), visible.evidence);
  } else {
    const facts = [item.activity_code && `államháztartási szakágazat ${item.activity_code}`, item.section_code && `költségvetési fejezet ${item.section_code}`].filter(Boolean).join(" · ");
    document.getElementById("details-title").textContent = item.name;
    document.getElementById("details-body").innerHTML = `<p>PIR ${escapeHtml(item.pir)}${facts ? ` · ${escapeHtml(facts)}` : ""}</p><span class="state">Mai K-TÖRZS-találat</span><p>Ebben a közfeladat-útvonalban a kiválasztott időpontban nem jelenik meg.</p>`;
  }
  document.getElementById("search-results").hidden = true;
}

function wireSearch() {
  const input = document.getElementById("directory-search");
  const results = document.getElementById("search-results");
  input.addEventListener("input", () => {
    const query = input.value.trim().toLocaleLowerCase("hu-HU");
    if (!query) { results.hidden = true; return; }
    const matches = state.data.current_directory.filter(item =>
      item.name.toLocaleLowerCase("hu-HU").includes(query) ||
      item.pir.includes(query) || String(item.activity_code || "").includes(query)
    ).slice(0, 8);
    results.replaceChildren();
    matches.forEach(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result";
      button.innerHTML = `<strong>${escapeHtml(item.name)}</strong><span>PIR ${escapeHtml(item.pir)}${item.activity_code ? ` · ${escapeHtml(item.activity_code)}` : ""}</span>`;
      button.addEventListener("click", () => showDirectoryItem(item));
      results.appendChild(button);
    });
    if (!matches.length) results.innerHTML = '<div class="search-result">Nincs találat.</div>';
    results.hidden = false;
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Escape") results.hidden = true;
    if (event.key === "Enter") results.querySelector("button")?.click();
  });
}

function start() {
  try {
    if (!window.ORGANO_DATA) throw new Error("hiányzik a generált snapshots.js");
    state.data = window.ORGANO_DATA;
    document.getElementById("baseline-count").textContent = state.data.overview.current_central_count.toLocaleString("hu-HU");
    wirePlayback();
    wireSearch();
    renderSnapshot(0);
  } catch (error) {
    document.getElementById("graph").innerHTML = `<div class="error">Az adatfájl nem tölthető be: ${escapeHtml(error.message)}. Futtasd újra a build-all parancsot.</div>`;
  }
}

start();
