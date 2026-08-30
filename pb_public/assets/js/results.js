/**
 * =============================================================================
 * results.js — pb_public/assets/js/results.js
 *
 * Public, read-only completed-results view for a single tournament.
 * Renders a scoreboard-style result card (big score, winner emphasis, round/
 * court context) per the product brief's "feel like sports results, not
 * database rows" goal — deliberately distinct from fixtures.html's compact
 * schedule-row cards. Most recently decided game first (by actual
 * last-updated time, a real recency signal).
 *
 * Self-contained (own pb client), same pattern as fixtures.js/tournament.js —
 * does not depend on db.js/state.js/app.js.
 *
 * URL: results.html?id=<tournament id>
 *
 * Depends on: config.js (escHtml), shell.js (Shell)
 * =============================================================================
 */

const pb = new PocketBase(CONFIG.API_BASE_URL);

const ResultsPage = {

  tournament : null,
  results    : [],

  async init() {
    await Shell.injectNav();
    Shell.renderAuthBar(pb);

    const params = new URLSearchParams(window.location.search);
    const id     = params.get('id');

    if (!id) {
      ResultsPage._showError('No tournament ID in the URL. Open this page from a tournament overview.');
      return;
    }

    try {
      const [tournament, fixtures] = await Promise.all([
        pb.collection('tournaments').getOne(id),
        pb.collection('fixtures').getFullList({
          filter    : `tournament="${id}" && status="completed" && is_bye=false`,
          sort      : '-updated',
          expand    : 'home_team.master_team,away_team.master_team,winner,court',
          requestKey: null,
        }),
      ]);

      ResultsPage.tournament = tournament;
      ResultsPage.results    = fixtures;

      ResultsPage._renderHeader(id);
      ResultsPage._renderResults();

    } catch (e) {
      console.error('ResultsPage.init failed', e);
      ResultsPage._showError(`Could not load results: ${e.message}`);
    }
  },

  _renderHeader(id) {
    const t = ResultsPage.tournament;
    document.getElementById('res-title').textContent = t.event_name || t.name;
    document.title = `Results — ${t.event_name || t.name} | Junior Ballers 254`;

    const metaParts = [t.name, t.format.replace(/_/g, ' ')];
    if (t.age_group || t.gender) metaParts.push([t.age_group, t.gender].filter(Boolean).join(' '));
    document.getElementById('res-meta').textContent = metaParts.filter(Boolean).join(' · ');

    const tagEl = document.getElementById('res-tag');
    if (tagEl) tagEl.innerHTML = tournamentTagHtml(t);

    const crumbs = [];
    if (t.event_name) crumbs.push({ label: t.event_name, href: `tournament.html?event=${encodeURIComponent(t.event_name)}` });
    crumbs.push({ label: t.name, href: `tournament.html?id=${id}` });
    crumbs.push({ label: 'Results' });
    Shell.renderBreadcrumb('breadcrumb-nav', crumbs);

    Shell.renderCategoryNav('res-nav', id, 'results');
  },

  // Optional round/group narrowing, same interaction as fixtures.html's
  // filter — built from whatever round/group labels actually appear among
  // the completed results, in the order they were first seen (most-recent-
  // first order from the fetch, so the filter list roughly matches "recency
  // of that round/group").
  _renderResults() {
    const results = ResultsPage.results;
    const listEl   = document.getElementById('res-list');
    const filterEl = document.getElementById('res-filter');

    if (!results.length) {
      listEl.innerHTML = `<div class="empty-state">
        <span class="empty-icon">🏀</span>No results yet — check back once games are underway.
      </div>`;
      return;
    }

    const seenKeys = new Map();
    results.forEach(f => {
      const key   = f.group_name ? `group-${f.group_name}` : `round-${f.round}`;
      const label = f.group_name || f.round_label || `Round ${f.round}`;
      if (!seenKeys.has(key)) seenKeys.set(key, label);
    });

    if (seenKeys.size > 1) {
      filterEl.style.display = '';
      filterEl.innerHTML = '<option value="all">All rounds</option>' +
        [...seenKeys.entries()].map(([key, label]) => `<option value="${key}">${escHtml(label)}</option>`).join('');
      filterEl.onchange = () => ResultsPage._applyFilter(filterEl.value);
    }

    listEl.innerHTML = results.map(ResultsPage._resultCard).join('');
  },

  _applyFilter(key) {
    document.querySelectorAll('#res-list [data-section-key]').forEach(el => {
      el.style.display = (key === 'all' || el.dataset.sectionKey === key) ? '' : 'none';
    });
  },

  _resultCard(f) {
    const homeHtml = teamDisplayHtml(f.expand?.home_team);
    const awayHtml = teamDisplayHtml(f.expand?.away_team);
    const wHome = f.winner === f.home_team;
    const wAway = f.winner === f.away_team;
    const round = f.round_label || `Round ${f.round}`;
    const court = f.expand?.court?.court_name || f.court_label || '';
    const key   = f.group_name ? `group-${f.group_name}` : `round-${f.round}`;

    const metaBits = [f.group_name, court].filter(Boolean);

    return `<div class="result-card" data-section-key="${key}">
      <div class="result-teams">
        <div class="result-team ${wHome ? 'winner' : ''}">
          <span class="result-team-name">${homeHtml}</span>
          <span class="result-team-score">${f.home_score}</span>
        </div>
        <div class="result-team ${wAway ? 'winner' : ''}">
          <span class="result-team-name">${awayHtml}</span>
          <span class="result-team-score">${f.away_score}</span>
        </div>
      </div>
      <div class="result-meta">
        <span class="result-round-badge">${escHtml(round)}</span>
        ${metaBits.map(b => `<span>${escHtml(b)}</span>`).join('')}
      </div>
    </div>`;
  },

  _showError(msg) {
    document.getElementById('res-title').textContent = 'Results';
    document.getElementById('res-body').style.display = 'none';
    const banner = document.getElementById('res-error');
    document.getElementById('res-error-msg').textContent = msg;
    banner.classList.add('visible');
  },
};

document.addEventListener('DOMContentLoaded', () => {
  ResultsPage.init().catch(e => console.error('ResultsPage.init failed', e));
});
