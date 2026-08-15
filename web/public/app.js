const resolveSection = document.getElementById('resolve-result');
const dossierSection = document.getElementById('dossier');
const statusFooter = document.getElementById('status-footer');
const form = document.getElementById('search-form');
const nameInput = document.getElementById('name-input');
const promoterInput = document.getElementById('promoter-input');
const stateToggle = document.getElementById('state-toggle');
const examplesEl = document.getElementById('examples');

// A query always targets exactly ONE state — chosen explicitly here, never
// implied. `currentState` is the single value threaded through every API call.
let currentState = null;
const stateNames = {}; // code -> display name (e.g. 'TN' -> 'Tamil Nadu')

// State-specific example chips — each state's registry has different landmark
// projects, so the demo suggestions follow the selected state.
const EXAMPLES = {
  KA: [
    { label: 'Godraj United (typo)', name: 'Godraj United' },
    { label: 'Lakeside Habitat', name: 'Lakeside Habitat', promoter: 'Prestige' },
    { label: 'Brigade El Dorado', name: 'Brigade El Dorado' },
    { label: 'Just a developer name →', promoter: 'Prestige Habitat Ventures' },
  ],
  TN: [
    { label: 'Purva Windermere', name: 'Purva Windermere' },
    { label: 'Crown Residences (Baashyaam)', name: 'Crown Residences', promoter: 'Baashyaam Constructions' },
    { label: 'Hill View Haven Phase 2', name: 'Hill View Haven Phase 2' },
    { label: 'Tulive', name: 'Tulive' },
  ],
};

const money = (v) => (v ? `₹${Number(v).toLocaleString('en-IN')}` : null);

// Registry source data sometimes comes through with literal, undecoded HTML
// entities (e.g. a promoter name containing the text "&amp;" rather than a
// real "&" — the portal's own markup wasn't entity-decoded when scraped).
// Decode first so escaping below doesn't double-encode it into "&amp;amp;".
const decodeEntitiesEl = document.createElement('textarea');
const decodeEntities = (s) => {
  decodeEntitiesEl.innerHTML = s;
  return decodeEntitiesEl.value;
};
const esc = (s) =>
  decodeEntities(String(s ?? '')).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

async function loadStatus() {
  try {
    const res = await fetch(`/api/status?state=${encodeURIComponent(currentState)}`);
    const data = await res.json();
    if (!data.ready) {
      statusFooter.textContent = `${stateNames[currentState] ?? currentState} index not built yet.`;
      return;
    }
    statusFooter.textContent =
      `${stateNames[data.state] ?? data.state} index: ${data.totalRecords.toLocaleString('en-IN')} projects — synced ${new Date(data.fetchedAt).toLocaleDateString()}`;
  } catch {
    statusFooter.textContent = '';
  }
}

// Populate the example chips for the active state.
function renderExamples() {
  const chips = EXAMPLES[currentState] ?? [];
  examplesEl.innerHTML =
    'Try: ' +
    chips
      .map(
        (c) =>
          `<button class="chip" data-name="${esc(c.name ?? '')}" data-promoter="${esc(c.promoter ?? '')}">${esc(c.label)}</button>`,
      )
      .join('');
  examplesEl.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      nameInput.value = chip.dataset.name ?? '';
      promoterInput.value = chip.dataset.promoter ?? '';
      dispatchSearch(chip.dataset.name ?? '', chip.dataset.promoter ?? '');
    });
  });
}

// Reflect the active state in the segmented toggle.
function updateToggleActive() {
  stateToggle.querySelectorAll('.state-option').forEach((btn) => {
    const active = btn.dataset.state === currentState;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

// Switching state is a hard context switch — clear any prior results so a
// record from one registry is never shown under another.
function onStateChange(next) {
  if (next === currentState) return;
  currentState = next;
  updateToggleActive();
  hide(resolveSection);
  hide(dossierSection);
  resolveSection.innerHTML = '';
  dossierSection.innerHTML = '';
  searchHint.textContent = '';
  nameInput.value = '';
  promoterInput.value = '';
  renderExamples();
  loadStatus();
}

function renderStateToggle(states) {
  stateToggle.innerHTML = states
    .map((s) => {
      const count = typeof s.totalRecords === 'number' ? `<span class="state-count">${s.totalRecords.toLocaleString('en-IN')}</span>` : '';
      return `<button type="button" class="state-option" data-state="${esc(s.code)}" aria-pressed="false">
        <span class="state-name">${esc(s.name)}</span>${count}
      </button>`;
    })
    .join('');
  stateToggle.querySelectorAll('.state-option').forEach((btn) => {
    btn.addEventListener('click', () => onStateChange(btn.dataset.state));
  });
  updateToggleActive();
}

async function init() {
  let states = [];
  try {
    const res = await fetch('/api/states');
    states = (await res.json()).states ?? [];
  } catch {
    states = [{ code: 'KA', name: 'Karnataka' }];
  }
  for (const s of states) stateNames[s.code] = s.name;
  currentState = states[0]?.code ?? 'KA';
  renderStateToggle(states);
  renderExamples();
  loadStatus();
}

const searchHint = document.getElementById('search-hint');

form.addEventListener('submit', (e) => {
  e.preventDefault();
  dispatchSearch(nameInput.value.trim(), promoterInput.value.trim());
});

function dispatchSearch(name, promoterName) {
  if (!name && !promoterName) {
    searchHint.textContent = 'Enter a project name, a developer name, or both.';
    return;
  }
  searchHint.textContent = '';
  if (name) {
    // Project name search, optionally narrowed by the developer hint.
    runResolve(name, promoterName);
  } else {
    // No project name — search directly by developer.
    hide(resolveSection);
    loadPromoter(promoterName);
  }
}

async function runResolve(name, promoterName) {
  hide(dossierSection);
  show(resolveSection);
  resolveSection.innerHTML = '<p class="loading">Resolving locally…</p>';

  const params = new URLSearchParams({ name, state: currentState });
  if (promoterName) params.set('promoter', promoterName);

  let result;
  try {
    const res = await fetch(`/api/resolve?${params}`);
    result = await res.json();
    if (!res.ok) throw new Error(result.error ?? 'resolve failed');
  } catch (err) {
    resolveSection.innerHTML = `<p class="error">Resolve failed: ${esc(err.message)}</p>`;
    return;
  }

  renderResolveResult(result);
}

const VISIBLE_CANDIDATES = 3;

// "token" (fuzzy token-set matching) is the common case and its own evidence
// text already explains it — a raw tier label there is jargon, not signal.
// Only the two tiers a reader should actually weigh differently get a chip.
const TIER_LABELS = { exact: 'Exact match', llm_semantic: 'AI-assisted match' };

function candidateCardHtml(c) {
  const pct = Math.round(c.matchScore * 100);
  const tierChip = TIER_LABELS[c.matchTier]
    ? `<span class="tier-chip tier-${esc(c.matchTier)}">${esc(TIER_LABELS[c.matchTier])}</span>`
    : '';
  return `
    <article class="candidate" data-reg="${esc(c.regNumber)}">
      <div class="candidate-head">
        <h3>${esc(c.registeredName)}</h3>
        ${tierChip}
        <span class="dataset-chip dataset-${esc(c.dataset)}">${esc(c.dataset)}</span>
      </div>
      <p class="promoter-name">${esc(c.promoterName)}</p>
      <div class="score-bar"><div class="score-fill" style="width:${pct}%"></div><span>${pct}%</span></div>
      <p class="evidence">${esc(c.evidence)}</p>
      <p class="reg-number">${esc(c.regNumber)}</p>
      <div class="candidate-actions">
        <button class="view-project">View project</button>
        <button class="view-promoter" data-promoter="${esc(c.promoterName)}">View promoter</button>
      </div>
    </article>`;
}

function renderResolveResult(result) {
  const statusLabel = {
    high_confidence: 'High confidence',
    ambiguous: 'Ambiguous — multiple plausible matches',
    unresolved: 'Unresolved',
  }[result.status] ?? result.status;

  let html = `<div class="status-banner status-${result.status}">${esc(statusLabel)}</div>`;

  if (result.candidates.length === 0) {
    const reason = result.unresolvedReason === 'no_candidates'
      ? 'No candidate in the local index matched this name.'
      : (result.unresolvedReason ?? 'No candidates.');
    html += `<p class="empty">${esc(reason)}</p>`;
  } else {
    const visible = result.candidates.slice(0, VISIBLE_CANDIDATES);
    const rest = result.candidates.slice(VISIBLE_CANDIDATES);

    html += '<div class="candidates">';
    html += visible.map(candidateCardHtml).join('');
    html += '</div>';

    if (rest.length > 0) {
      const moreLabel = `Show ${rest.length} more, lower-confidence match${rest.length > 1 ? 'es' : ''}`;
      html += `<div class="candidates more-candidates hidden">${rest.map(candidateCardHtml).join('')}</div>`;
      html += `<button class="show-more" type="button" data-more-label="${esc(moreLabel)}">${esc(moreLabel)}</button>`;
    }
  }

  resolveSection.innerHTML = html;
  wireCandidateActions(resolveSection);

  const showMoreBtn = resolveSection.querySelector('.show-more');
  if (showMoreBtn) {
    showMoreBtn.addEventListener('click', () => {
      const more = resolveSection.querySelector('.more-candidates');
      const nowHidden = more.classList.toggle('hidden');
      showMoreBtn.textContent = nowHidden ? showMoreBtn.dataset.moreLabel : 'Show fewer matches';
    });
  }
}

function wireCandidateActions(root) {
  root.querySelectorAll('.view-project').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const regNumber = e.target.closest('.candidate').dataset.reg;
      loadProject(regNumber);
    });
  });
  root.querySelectorAll('.view-promoter').forEach((btn) => {
    btn.addEventListener('click', (e) => loadPromoter(e.target.dataset.promoter));
  });
}

async function loadProject(regNumber) {
  show(dossierSection);
  dossierSection.innerHTML = `<p class="loading">Querying the live ${esc(stateNames[currentState] ?? currentState)} RERA portal… (can take up to 20s)</p>`;
  dossierSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  let project;
  try {
    const res = await fetch(`/api/project?regNumber=${encodeURIComponent(regNumber)}&state=${encodeURIComponent(currentState)}`);
    project = await res.json();
    if (!res.ok) throw new Error(project.error ?? 'fetch failed');
  } catch (err) {
    dossierSection.innerHTML = `<p class="error">Could not fetch project detail: ${esc(err.message)}</p>`;
    return;
  }

  renderProject(project);
}

const DOCUMENT_LABELS = { approval: 'Approval details', carpet: 'Carpet-area statement', formA: 'Form A', status: 'Current status' };

// Official source-document (PDF) links, shown whenever present — e.g. Tamil
// Nadu's offline projects carry scanned approval/carpet PDFs.
function documentsHtml(p) {
  const docs = p.documents ? Object.entries(p.documents) : [];
  if (docs.length === 0) return '';
  return `<h3>Official documents</h3>
    <ul class="documents">
      ${docs.map(([k, url]) => `<li><a href="${esc(url)}" target="_blank" rel="noopener">${esc(DOCUMENT_LABELS[k] ?? k)} (PDF) →</a></li>`).join('')}
    </ul>`;
}

function renderProject(p) {
  if (p.fetchState === 'detail_unavailable') {
    const docs = documentsHtml(p);
    const body = docs
      ? `<p class="notice">This is an older, paper-filed registration — ${esc(stateNames[p.state] ?? p.state ?? 'the state')}'s portal exposes it only as scanned documents. Here are the official records:</p>${docs}`
      : `<p class="notice">The live government portal didn't respond just now — it can be slow, temporarily down, or unreachable from this environment. The local registry index still confirms this project exists. Try again in a moment.</p>`;
    dossierSection.innerHTML = `
      <div class="dossier-card">
        <h2>${esc(p.registeredName)}</h2>
        <p class="reg-number">${esc(p.regNumber)}</p>
        ${body}
      </div>`;
    return;
  }

  const rows = [
    ['Status', p.projectStatus],
    ['Start date', p.projectStartDate],
    ['End date', p.projectEndDate],
    ['Project type', p.projectType],
    ['Usage', p.usage],
    ['Site extent (sq.m)', p.siteAreaSqm],
    ['Extent developed', p.extentDevelopedPct],
    ['Address', p.projectAddress],
    ['Plots / units', p.numberOfPlotsOrUnits],
    ['Total project cost', money(p.totalProjectCostInr)],
    ['Total construction cost', money(p.totalConstructionCostInr)],
    ['Bank', [p.bankName, p.bankBranch].filter(Boolean).join(', ')],
    ['IFSC', p.ifscCode],
    ['Approving authority', p.approvingAuthority],
    ['Plan approval date', p.planApprovalDate],
  ].filter(([, v]) => v);

  // lat/long come from scraped portal HTML as untrusted strings — validate as
  // real coordinates before building the link, so a poisoned value can't break
  // out of the href attribute (DOM XSS). encodeURIComponent is belt-and-braces.
  const isCoord = (v) => /^-?\d{1,3}(\.\d+)?$/.test(String(v).trim());
  const gps = isCoord(p.latitude) && isCoord(p.longitude)
    ? `<a class="gps-link" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${encodeURIComponent(String(p.latitude).trim())},${encodeURIComponent(String(p.longitude).trim())}">View on map</a>`
    : '';

  const complaints = (p.complaintsOnProject != null || p.complaintsOnPromoter != null)
    ? `<div class="complaints">
        <div class="complaint-stat"><span class="num">${p.complaintsOnProject ?? '—'}</span><span>complaints on this project</span></div>
        <div class="complaint-stat"><span class="num">${p.complaintsOnPromoter ?? '—'}</span><span>complaints on promoter</span></div>
      </div>`
    : '';

  const promoter = p.promoter ? renderPromoterProfile(p.promoter) : '';

  dossierSection.innerHTML = `
    <div class="dossier-card">
      <h2>${esc(p.registeredName)}</h2>
      <p class="reg-number">${esc(p.regNumber)}</p>
      ${complaints}
      <table class="detail-table">
        ${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
      </table>
      ${gps}
      ${documentsHtml(p)}
      <h3>Promoter</h3>
      <p class="promoter-name-lg">${esc(p.promoterName)} <button class="view-promoter" data-promoter="${esc(p.promoterName)}">View full promoter profile</button></p>
      ${promoter}
    </div>`;

  dossierSection.querySelectorAll('.view-promoter').forEach((btn) => {
    btn.addEventListener('click', (e) => loadPromoter(e.target.dataset.promoter));
  });
}

function renderPromoterProfile(profile) {
  const rows = [
    ['Type of firm', profile.typeOfFirm],
    ['CIN / registration no.', profile.registrationNumber],
    ['GSTIN', profile.gstin],
    ['PAN', profile.pan],
    ['Email', profile.email],
    ['Mobile', profile.mobile],
    ['Website', profile.website],
    ['Occupation', profile.occupation],
    ["Father's name", profile.fathersName],
    ['Address', profile.address],
    ['District', profile.district],
    ['Taluk', profile.taluk],
    ['PIN code', profile.pinCode],
    ['CEO / MD', profile.ceoOrMd],
    ['Authorized signatory', profile.authorizedSignatory],
    ['DIN', profile.din],
    ['Partners / directors', Array.isArray(profile.directorNames) ? profile.directorNames.join(', ') : profile.numberOfDirectors],
  ].filter(([, v]) => v);
  if (rows.length === 0) return '';
  return `<table class="detail-table">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
}

async function loadPromoter(name) {
  show(dossierSection);
  dossierSection.innerHTML = `<p class="loading">Querying the live ${esc(stateNames[currentState] ?? currentState)} RERA portal for promoter profile…</p>`;
  dossierSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  let data;
  try {
    const res = await fetch(`/api/promoter?name=${encodeURIComponent(name)}&state=${encodeURIComponent(currentState)}`);
    data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'fetch failed');
  } catch (err) {
    dossierSection.innerHTML = `<p class="error">Could not fetch promoter detail: ${esc(err.message)}</p>`;
    return;
  }

  renderPromoter(data.promoter, data.investigation);
}

function renderPromoter(promoter, investigation) {
  const profileHtml = promoter.profile
    ? renderPromoterProfile(promoter.profile)
    : '<p class="notice">The live government portal didn\'t return a profile for this promoter just now — it can be slow, temporarily down, or unreachable from this environment. Try again in a moment.</p>';

  const investigationHtml = investigation.matches.length > 0
    ? `<div class="investigation-badge warn">
        ⚠ Flagged on RERA's "Under Investigation" enforcement list (${investigation.matches.length} match${investigation.matches.length > 1 ? 'es' : ''}).
        <p class="warning-text">${esc(investigation.warning)}</p>
      </div>`
    : `<div class="investigation-badge ok">
        No match on RERA's "Under Investigation" list.
        <p class="warning-text">${esc(investigation.warning)}</p>
      </div>`;

  const projectsHtml = promoter.projects.length > 0
    ? `<ul class="portfolio">
        ${promoter.projects.map((p) => `
          <li data-reg="${esc(p.regNumber)}" title="${esc(p.evidence)}">
            <span class="portfolio-name">${esc(p.registeredName)}</span>
            <span class="portfolio-meta">
              ${p.matchTier !== 'exact' ? `<span class="portfolio-score">${Math.round(p.matchScore * 100)}% match</span>` : ''}
              <span class="dataset-chip dataset-${esc(p.dataset)}">${esc(p.dataset)}</span>
            </span>
          </li>`).join('')}
      </ul>
      <p class="portfolio-note">Entries below 100% are fuzzy promoter-name matches, not confirmed registrations — hover an entry for the match evidence.</p>`
    : '<p class="empty">No projects found in the local index for this promoter.</p>';

  dossierSection.innerHTML = `
    <div class="dossier-card">
      <h2>${esc(promoter.promoterName)}</h2>
      ${investigationHtml}
      <h3>Profile</h3>
      ${profileHtml}
      <h3>Project portfolio (${promoter.projects.length})</h3>
      ${projectsHtml}
    </div>`;

  dossierSection.querySelectorAll('.portfolio li').forEach((li) => {
    li.addEventListener('click', () => loadProject(li.dataset.reg));
    li.style.cursor = 'pointer';
  });
}

init();
