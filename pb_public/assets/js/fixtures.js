/**
 * =============================================================================
 * fixtures.js — pb_public/assets/js/fixtures.js
 *
 * Public, read-only full schedule for a single tournament. Groups fixtures
 * by round (round_robin/elimination) or by group name + knockout round
 * (group_stage), with a simple round/group filter dropdown. Self-contained
 * (own pb client), same pattern as tournament.js/teams.js/stats.js — does
 * not depend on db.js/state.js/app.js.
 *
 * URL: fixtures.html?id=<tournament id>
 *
 * Depends on: config.js (escHtml), shell.js (Shell)
 * =============================================================================
 */

const pb = new PocketBase(CONFIG.API_BASE_URL);

const FixturesPage = {

  tournament : null,
  fixtures   : [],

  async init() {
    await Shell.injectNav();
    Shell.renderAuthBar(pb);

    const params = new URLSearchParams(window.location.search);
    const id     = params.get('id');

    if (!id) {
      FixturesPage._showError('No tournament ID in the URL. Open this page from a tournament overview.');
      return;
    }

    try {
      const [tournament, fixtures] = await Promise.all([
        pb.collection('tournaments').getOne(id),
        pb.collection('fixtures').getFullList({
          filter    : `tournament="${id}"`,
          sort      : 'round,match_number',
          expand    : 'home_team,away_team,winner,court',
          requestKey: null,
        }),
      ]);

      FixturesPage.tournament = tournament;
      FixturesPage.fixtures   = fixtures.filter(f => !f.is_bye);

      FixturesPage._renderHeader(id);
      FixturesPage._renderSections();

    } catch (e) {
      console.error('FixturesPage.init failed', e);
      FixturesPage._showError(`Could not load fixtures: ${e.message}`);
    }
  },

  _renderHeader(id) {
    const t = FixturesPage.tournament;
    document.getElementById('fx-title').textContent = t.event_name || t.name;
    document.title = `Fixtures — ${t.event_name || t.name} | Junior Ballers 254`;

    const metaParts = [t.name, t.format.replace(/_/g, ' ')];
    if (t.age_group || t.gender) metaParts.push([t.age_group, t.gender].filter(Boolean).join(' '));
    document.getElementById('fx-meta').textContent = metaParts.filter(Boolean).join(' · ');

    document.getElementById('fx-nav').innerHTML = `
      <a class="btn sm ghost" href="tournament.html?id=${id}">Overview</a>
      <span class="btn sm primary" style="pointer-events:none;">Fixtures</span>
      <a class="btn sm ghost" href="results.html?id=${id}">Results</a>
      <a class="btn sm ghost" href="standings.html?id=${id}">Standings</a>
      <a class="btn sm ghost" href="bracket.html?id=${id}">Bracket</a>
      <a class="btn sm ghost" href="teams.html?tournament=${id}">Teams registry</a>
    `;
  },

  // Groups fixtures into ordered sections — one per group_name for group
  // stage matches, one per round otherwise. Order of first appearance in
  // the already round/match-sorted fixture list becomes section order, so
  // groups and knockout rounds naturally interleave correctly.
  _buildSections() {
    const sections = [];
    const byKey     = new Map();

    FixturesPage.fixtures.forEach(f => {
      const key   = f.group_name ? `group-${f.group_name}` : `round-${f.round}`;
      const label = f.group_name || f.round_label || `Round ${f.round}`;
      if (!byKey.has(key)) {
        const section = { key, label, matches: [] };
        byKey.set(key, section);
        sections.push(section);
      }
      byKey.get(key).matches.push(f);
    });

    return sections;
  },

  _renderSections() {
    const sections = FixturesPage._buildSections();
    const listEl   = document.getElementById('fx-list');
    const filterEl = document.getElementById('fx-filter');

    if (!sections.length) {
      listEl.innerHTML = `<div class="empty-state">
        <span class="empty-icon">🏀</span>No fixtures generated yet for this tournament.
      </div>`;
      return;
    }

    if (sections.length > 1) {
      filterEl.style.display = '';
      filterEl.innerHTML = '<option value="all">All rounds</option>' +
        sections.map(s => `<option value="${s.key}">${escHtml(s.label)}</option>`).join('');
      filterEl.onchange = () => FixturesPage._applyFilter(filterEl.value);
    }

    listEl.innerHTML = sections.map(s => `
      <div class="round-section" data-section-key="${s.key}">
        <div class="round-label">${escHtml(s.label)}</div>
        ${s.matches.map(FixturesPage._matchCard).join('')}
      </div>`).join('');
  },

  _applyFilter(key) {
    document.querySelectorAll('#fx-list [data-section-key]').forEach(el => {
      el.style.display = (key === 'all' || el.dataset.sectionKey === key) ? '' : 'none';
    });
  },

  _matchCard(f) {
    const home   = f.expand?.home_team?.name || 'TBD';
    const away   = f.expand?.away_team?.name || 'TBD';
    const isDone = f.status === 'completed';
    const wHome  = isDone && f.winner === f.home_team;
    const wAway  = isDone && f.winner === f.away_team;

    const when = f.scheduled_start_time
      ? new Date(f.scheduled_start_time).toLocaleString(undefined, {
          weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        })
      : (f.scheduled_time || '');
    const court     = f.expand?.court?.court_name || f.court_label || '';
    const timeCourt = [when, court].filter(Boolean).join(' · ');

    return `<div class="match-card ${isDone ? 'completed' : ''}">
      <span class="match-num">${escHtml(f.round_label || ('R' + f.round))}</span>
      <span class="team-a ${wHome ? 'winner-bold' : ''} ${home === 'TBD' ? 'tbd' : ''}">${escHtml(home)}</span>
      <span class="vs">vs</span>
      <span class="team-b ${wAway ? 'winner-bold' : ''} ${away === 'TBD' ? 'tbd' : ''}">${escHtml(away)}</span>
      ${isDone
        ? `<span class="match-score">${f.home_score} – ${f.away_score}</span>`
        : (timeCourt ? `<div class="match-timecourt-chip">${escHtml(timeCourt)}</div>` : '')}
    </div>`;
  },

  _showError(msg) {
    document.getElementById('fx-title').textContent = 'Fixtures';
    document.getElementById('fx-body').style.display = 'none';
    const banner = document.getElementById('fx-error');
    document.getElementById('fx-error-msg').textContent = msg;
    banner.classList.add('visible');
  },
};

document.addEventListener('DOMContentLoaded', () => {
  FixturesPage.init().catch(e => console.error('FixturesPage.init failed', e));
});
