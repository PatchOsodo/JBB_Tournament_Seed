/**
 * =============================================================================
 * tournament.js — pb_public/assets/js/tournament.js
 *
 * Public, read-only overview for a tournament. Has TWO modes:
 *
 *   ?id=<tournaments.id>   — single-category mode (unchanged from before
 *                            Phase 5). One `tournaments` record IS one
 *                            category, so this is exactly what the page
 *                            has always shown.
 *
 *   ?event=<event_name>    — NEW event-level overview mode. Shows the whole
 *                            tournament across every category sharing that
 *                            event_name: categories list, cross-category
 *                            upcoming games / recent results (each labeled
 *                            with its category), and a per-category
 *                            standings preview. If the event only has ONE
 *                            category, this redirects straight to that
 *                            category's ?id= page — there's nothing to
 *                            "overview" for a single-category event.
 *
 * Event-mode reuses Events.summarize (events.js) for grouping/summary
 * fields, and the real _computeGroupStandings (generators.js) for
 * standings — no third duplicate of that ranking logic.
 *
 * Self-contained (own pb client), same pattern as teams.js/stats.js — does
 * not depend on db.js/state.js/app.js.
 *
 * Depends on: config.js (escHtml), logger.js + generators.js
 *             (_computeGroupStandings), events.js (Events), shell.js (Shell)
 * =============================================================================
 */

const pb = new PocketBase(CONFIG.API_BASE_URL);

const TournamentPage = {

  // Single-category mode state
  tournament : null,
  fixtures   : [],

  // Event-mode state
  eventSummary : null,
  favourites   : [],

  async init() {
    await Shell.injectNav();
    Shell.renderAuthBar(pb);

    const params    = new URLSearchParams(window.location.search);
    const id        = params.get('id');
    const eventName = params.get('event');

    TournamentPage.favourites = await TournamentPage._loadFavourites();

    if (eventName) {
      await TournamentPage._initEventMode(eventName);
      return;
    }

    if (!id) {
      TournamentPage._showError('No tournament ID in the URL. Open this page from a tournament card.');
      return;
    }

    try {
      const [tournament, teamsCount, fixtures] = await Promise.all([
        pb.collection('tournaments').getOne(id),
        pb.collection('teams').getList(1, 1, { filter: `tournament="${id}"`, requestKey: null }),
        pb.collection('fixtures').getFullList({
          filter    : `tournament="${id}"`,
          sort      : 'round,match_number',
          expand    : 'home_team.master_team,away_team.master_team,winner',
          requestKey: null,
        }),
      ]);

      TournamentPage.tournament = tournament;
      TournamentPage.fixtures   = fixtures;

      TournamentPage._renderHeader();
      TournamentPage._renderFollowControl({ mode: 'category', tournamentId: id });
      TournamentPage._renderNav(id);
      TournamentPage._renderStats(teamsCount.totalItems);
      TournamentPage._renderRecentResults();
      TournamentPage._renderNextUp();

    } catch (e) {
      console.error('TournamentPage.init failed', e);
      TournamentPage._showError(`Could not load this tournament: ${e.message}`);
    }
  },

  /* ═══════════════════════════════════════════════════════════════════════
   *  SINGLE-CATEGORY MODE — unchanged from before Phase 5
   *  ═══════════════════════════════════════════════════════════════════════ */

  _renderHeader() {
    const t = TournamentPage.tournament;
    document.getElementById('tourn-title').textContent = t.event_name || t.name;
    document.title = `${t.event_name || t.name} — Junior Ballers 254`;

    const metaParts = [t.name, t.format.replace(/_/g, ' ')];
    if (t.age_group || t.gender) metaParts.push([t.age_group, t.gender].filter(Boolean).join(' '));
    document.getElementById('tourn-meta').textContent = metaParts.filter(Boolean).join(' · ');

    const tagEl = document.getElementById('tourn-tag');
    if (tagEl) tagEl.innerHTML = tournamentTagHtml(t);

    const badge = document.getElementById('tourn-status');
    const label = { pending: 'Not yet started', active: 'Ongoing', completed: 'Complete' }[t.status] || t.status;
    badge.textContent = label;
    badge.className   = `status-badge badge-${t.status}`;
  },

  _renderNav(id) {
    Shell.renderCategoryNav('tourn-nav', id, 'overview');
  },
  _renderStats(teamsCount) {
    const fx     = TournamentPage.fixtures.filter(f => !f.is_bye);
    const played = fx.filter(f => f.status === 'completed').length;

    document.getElementById('tourn-stats-row').innerHTML = `
    <div class="stat-box"><div class="stat-val">${teamsCount}</div><div class="stat-lbl">Teams</div></div>
    <div class="stat-box"><div class="stat-val">${played}/${fx.length}</div><div class="stat-lbl">Played</div></div>
    <div class="stat-box"><div class="stat-val">${fx.length - played}</div><div class="stat-lbl">Remaining</div></div>
    `;
  },

  _renderRecentResults() {
    const el = document.getElementById('tourn-recent-results');
    const results = TournamentPage.fixtures
    .filter(f => !f.is_bye && f.status === 'completed')
    .sort((a, b) => new Date(b.updated) - new Date(a.updated))
    .slice(0, 5);

    if (!results.length) {
      el.innerHTML = `<div class="empty-state" style="padding:1.5rem 0;">
      <span class="empty-icon">🏀</span>No results yet — check back once games are underway.
      </div>`;
      return;
    }

    el.innerHTML = results.map(f => TournamentPage._matchCard(f, true)).join('');
  },

  _renderNextUp() {
    const el = document.getElementById('tourn-next-up');
    const next = TournamentPage.fixtures
    .filter(f => !f.is_bye && f.status === 'scheduled' && f.home_team && f.away_team)
    .slice(0, 5);

    if (!next.length) {
      el.innerHTML = `<div class="empty-state" style="padding:1.5rem 0;">
      <span class="empty-icon">📅</span>Nothing scheduled next right now.
      </div>`;
      return;
    }

    el.innerHTML = next.map(f => TournamentPage._matchCard(f, false)).join('');
  },

  _matchCard(f, isDone) {
    const homeHtml = teamDisplayHtml(f.expand?.home_team);
    const awayHtml = teamDisplayHtml(f.expand?.away_team);
    const wHome = isDone && f.winner === f.home_team;
    const wAway = isDone && f.winner === f.away_team;
    const when  = f.scheduled_start_time
    ? new Date(f.scheduled_start_time).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
    : (f.scheduled_time || f.round_label || `Round ${f.round}`);

    return `<div class="match-card ${isDone ? 'completed' : ''}">
    <span class="match-num">${escHtml(f.round_label || `R${f.round}`)}</span>
    <span class="team-a ${wHome ? 'winner-bold' : ''}">${homeHtml}</span>
    <span class="vs">vs</span>
    <span class="team-b ${wAway ? 'winner-bold' : ''}">${awayHtml}</span>
    ${isDone
      ? `<span class="match-score">${f.home_score} – ${f.away_score}</span>`
      : `<span class="match-timecourt-chip">${escHtml(when)}</span>`}
      </div>`;
  },

  /* ═══════════════════════════════════════════════════════════════════════
   *  EVENT MODE — NEW in Phase 5
   *  ═══════════════════════════════════════════════════════════════════════ */

  async _initEventMode(eventName) {
    try {
      const allTournaments = await pb.collection('tournaments').getFullList({
        filter    : `event_name="${eventName}"`,
        sort      : '-created',
        requestKey: null,
      });

      if (!allTournaments.length) {
        TournamentPage._showError(`No tournament found for "${eventName}".`);
        return;
      }

      const tournamentIds = allTournaments.map(t => t.id);
      const idFilter       = tournamentIds.map(id => `tournament="${id}"`).join('||');

      const [teams, fixtures] = await Promise.all([
        pb.collection('teams').getFullList({
          filter: `(${idFilter})`, expand: 'master_team', requestKey: null,
        }),
        pb.collection('fixtures').getFullList({
          filter    : `(${idFilter})`,
          sort      : 'round,match_number',
          expand    : 'home_team.master_team,away_team.master_team,winner,tournament',
          requestKey: null,
        }),
      ]);

      const teamCounts = {};
      teams.forEach(t => { teamCounts[t.tournament] = (teamCounts[t.tournament] || 0) + 1; });

      const summary = Events.summarize(eventName, allTournaments, teamCounts);

      // A single-category "event" isn't really an event overview — send
      // the user straight into the familiar category page instead of
      // showing a one-item shell around it.
      if (summary.categoryCount === 1) {
        window.location.replace(`tournament.html?id=${summary.tournaments[0].id}`);
        return;
      }

      TournamentPage.eventSummary = summary;

      TournamentPage._renderEventHeader(summary);
      TournamentPage._renderFollowControl({ mode: 'event', eventName: summary.displayName });
      TournamentPage._renderEventNav(summary);
      TournamentPage._renderEventStats(summary, fixtures);
      TournamentPage._renderEventUpcoming(fixtures);
      TournamentPage._renderEventResults(fixtures);
      TournamentPage._renderEventStandings(summary, fixtures, teams);
      TournamentPage._renderCategoriesList(summary);

    } catch (e) {
      console.error('TournamentPage._initEventMode failed', e);
      TournamentPage._showError(`Could not load this tournament: ${e.message}`);
    }
  },

  _renderEventHeader(summary) {
    document.getElementById('tourn-title').textContent = summary.displayName;
    document.title = `${summary.displayName} — Junior Ballers 254`;

    const metaBits = [
      `${summary.categoryCount} categor${summary.categoryCount === 1 ? 'y' : 'ies'}`,
      `${summary.teamCount} team${summary.teamCount === 1 ? '' : 's'}`,
    ];
    document.getElementById('tourn-meta').textContent = metaBits.join(' · ');

    const badge = document.getElementById('tourn-status');
    const label = { pending: 'Not yet started', active: 'Ongoing', completed: 'Complete' }[summary.status] || summary.status;
    badge.textContent = label;
    badge.className   = `status-badge badge-${summary.status}`;

    // Banner — reuses whichever category already has a banner_image, same
    // rule tournaments.js cards use. Gradient placeholder otherwise.
    const bannerEl = document.getElementById('tourn-banner');
    if (bannerEl) {
      bannerEl.innerHTML = summary.bannerOwner
      ? `<img class="tourn-banner-img" src="${pb.files.getURL(summary.bannerOwner, summary.bannerOwner.banner_image, { thumb: '1200x360' })}" alt="">`
      : `<div class="tourn-banner-placeholder"><span>🏀</span></div>`;
      bannerEl.style.display = '';
    }
  },

  // Event overview has no single Fixtures/Results/Standings/Bracket to
  // link to (those are per-category) — the categories list further down
  // the page is the drill-down path instead. Keep the nav strip minimal.
  _renderEventNav() {
    document.getElementById('tourn-nav').innerHTML = `
    <span class="btn sm primary" style="pointer-events:none;">Overview</span>
    <a class="btn sm ghost" href="teams.html">Teams registry</a>
    `;
  },

  _renderEventStats(summary, fixtures) {
    const real   = fixtures.filter(f => !f.is_bye);
    const played = real.filter(f => f.status === 'completed').length;

    document.getElementById('tourn-stats-row').innerHTML = `
    <div class="stat-box"><div class="stat-val">${summary.teamCount}</div><div class="stat-lbl">Teams</div></div>
    <div class="stat-box"><div class="stat-val">${summary.categoryCount}</div><div class="stat-lbl">Categories</div></div>
    <div class="stat-box"><div class="stat-val">${played}/${real.length}</div><div class="stat-lbl">Games played</div></div>
    `;
  },

  _renderEventUpcoming(fixtures) {
    const el = document.getElementById('tourn-next-up');
    const next = fixtures
    .filter(f => !f.is_bye && f.status === 'scheduled' && f.home_team && f.away_team)
    .sort((a, b) => {
      const at = a.scheduled_start_time ? new Date(a.scheduled_start_time).getTime() : Infinity;
      const bt = b.scheduled_start_time ? new Date(b.scheduled_start_time).getTime() : Infinity;
      return at - bt;
    })
    .slice(0, 6);

    if (!next.length) {
      el.innerHTML = `<div class="empty-state" style="padding:1.5rem 0;">
      <span class="empty-icon">📅</span>Nothing scheduled next right now.
      </div>`;
      return;
    }

    el.innerHTML = next.map(f => TournamentPage._eventMatchCard(f, false)).join('');
  },

  _renderEventResults(fixtures) {
    const el = document.getElementById('tourn-recent-results');
    const results = fixtures
    .filter(f => !f.is_bye && f.status === 'completed')
    .sort((a, b) => new Date(b.updated) - new Date(a.updated))
    .slice(0, 6);

    if (!results.length) {
      el.innerHTML = `<div class="empty-state" style="padding:1.5rem 0;">
      <span class="empty-icon">🏀</span>No results yet — check back once games are underway.
      </div>`;
      return;
    }

    el.innerHTML = results.map(f => TournamentPage._eventMatchCard(f, true)).join('');
  },

  // Same match-card shape as single-category mode, but the leading label
  // is the CATEGORY (e.g. "U16 Boys") instead of the round — every game
  // in event mode needs to say which category it belongs to.
  _eventMatchCard(f, isDone) {
    const homeHtml = teamDisplayHtml(f.expand?.home_team);
    const awayHtml = teamDisplayHtml(f.expand?.away_team);
    const wHome   = isDone && f.winner === f.home_team;
    const wAway   = isDone && f.winner === f.away_team;
    const catName = f.expand?.tournament?.name || '';
    const when    = f.scheduled_start_time
    ? new Date(f.scheduled_start_time).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
    : (f.scheduled_time || '');

    return `<div class="match-card ${isDone ? 'completed' : ''}">
    <span class="match-num">${escHtml(catName)}</span>
    <span class="team-a ${wHome ? 'winner-bold' : ''}">${homeHtml}</span>
    <span class="vs">vs</span>
    <span class="team-b ${wAway ? 'winner-bold' : ''}">${awayHtml}</span>
    ${isDone
      ? `<span class="match-score">${f.home_score} – ${f.away_score}</span>`
      : (when ? `<span class="match-timecourt-chip">${escHtml(when)}</span>` : '')}
      </div>`;
  },

  // One compact standings table PER category — never a fabricated combined
  // table across categories. Elimination categories are skipped entirely,
  // same rule standings.html already uses (a bracket doesn't have a
  // meaningful win/loss table). Uses the real _computeGroupStandings from
  // generators.js — not a fourth copy of the ranking logic.
  _renderEventStandings(summary, fixtures, teams) {
    const wrap = document.getElementById('tourn-standings-preview');
    if (!wrap) return;

    const sections = summary.tournaments.map(cat => {
      if (cat.format === 'elimination') return null;

      const catFixtures = fixtures.filter(f => {
        const tid = typeof f.tournament === 'object' ? f.tournament?.id : f.tournament;
        return tid === cat.id;
      });
      const catTeams = teams.filter(t => t.tournament === cat.id);
      if (!catFixtures.length || !catTeams.length) return null;

      let rows;
      if (cat.format === 'group_stage') {
        const groupNames = [...new Set(catFixtures.filter(f => f.group_name).map(f => f.group_name))].sort();
        if (!groupNames.length) return null;
        rows = _computeGroupStandings(catFixtures, catTeams, groupNames[0]).slice(0, 5);
      } else {
        // round_robin — whole category is effectively one group.
        rows = _computeGroupStandings(
          catFixtures.map(f => ({ ...f, group_name: '__all__' })),
                                      catTeams,
                                      '__all__'
        ).slice(0, 5);
      }

      // Don't show an all-zero table — wait for at least one real result.
      if (!rows.length || !rows.some(r => r.played > 0)) return null;

      const catLabel = [cat.age_group, cat.gender].filter(Boolean).join(' ') || cat.name;
      return { catLabel, catId: cat.id, rows };
    }).filter(Boolean);

    if (!sections.length) { wrap.innerHTML = ''; return; }

    wrap.innerHTML = `
    <div class="section-heading" style="margin-top:0;">Standings</div>
    <div class="event-standings-grid">
    ${sections.map(s => `
      <div class="standings-preview-card">
      <div class="standings-preview-title">${escHtml(s.catLabel)}</div>
      <table class="standings-preview-table">
      <thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>+/-</th></tr></thead>
      <tbody>
      ${s.rows.map((r, i) => `
        <tr>
        <td class="standings-preview-rank">${i + 1}</td>
        <td ${r.fullName && r.fullName !== r.name ? `title="${escHtml(r.fullName)}"` : ''}>${escHtml(r.name)}</td>
        <td class="standings-preview-num standings-preview-wins">${r.wins}</td>
        <td class="standings-preview-num">${r.losses}</td>
        <td class="standings-preview-num" style="color:${r.pointDiff >= 0 ? 'var(--accent)' : 'var(--danger)'}">
        ${r.pointDiff >= 0 ? '+' : ''}${r.pointDiff}
        </td>
        </tr>`).join('')}
        </tbody>
        </table>
        <a href="tournament.html?id=${s.catId}" class="standings-preview-link">View ${escHtml(s.catLabel)} →</a>
        </div>
        `).join('')}
        </div>`;
  },

  // The drill-down path from "whole tournament" into "one category" —
  // every existing category-specific page (fixtures/results/standings/
  // bracket/teams) is reached from here via the normal ?id= link.
  _renderCategoriesList(summary) {
    const wrap = document.getElementById('tourn-categories-list');
    if (!wrap) return;

    wrap.innerHTML = `
    <div class="section-heading">Categories</div>
    <div class="event-category-chips">
    ${summary.tournaments.map(cat => {
      const label = [cat.age_group, cat.gender].filter(Boolean).join(' ') || cat.name;
      const statusLabel = { pending: 'Not yet started', active: 'Ongoing', completed: 'Complete' }[cat.status] || cat.status;
      return `<a href="tournament.html?id=${cat.id}" class="event-category-chip">
      <span class="event-category-chip-name">${escHtml(label)}</span>
      <span class="status-badge badge-${cat.status}">${escHtml(statusLabel)}</span>
      </a>`;
    }).join('')}
    </div>`;
  },

  async _loadFavourites() {
    if (!pb.authStore.isValid) return [];
    try {
      return await pb.collection('favourites').getFullList({
        filter: `user="${pb.authStore.model.id}"`, requestKey: null,
      });
    } catch (e) {
      console.warn('TournamentPage._loadFavourites failed', e.message);
      return [];
    }
  },

  // Renders a labeled "Follow Tournament" / "Follow Category" button next
  // to the status badge. `opts` is either { mode:'category', tournamentId }
  // or { mode:'event', eventName }. Guests get a sign-in prompt instead of
  // silently failing.
  _renderFollowControl(opts) {
    const headerRight = document.querySelector('.app-header-right');
    if (!headerRight) return;

    document.getElementById('tourn-follow-btn')?.remove();

    const isEvent = opts.mode === 'event';
    const existing = isEvent
      ? TournamentPage.favourites.find(f => f.event_name === opts.eventName)
      : TournamentPage.favourites.find(f => {
          const tid = typeof f.tournament === 'object' ? f.tournament?.id : f.tournament;
          return tid === opts.tournamentId;
        });

    const label = isEvent ? 'Follow Tournament' : 'Follow Category';
    const btn = document.createElement('button');
    btn.id = 'tourn-follow-btn';
    btn.className = 'btn sm ghost';
    btn.textContent = existing ? '★ Following' : `☆ ${label}`;
    btn.onclick = () => TournamentPage._toggleFollow(opts, existing);
    headerRight.appendChild(btn);
  },

  async _toggleFollow(opts, existing) {
    if (!pb.authStore.isValid) {
      alert('Sign in to follow tournaments and categories.');
      return;
    }
    try {
      if (existing) {
        await pb.collection('favourites').delete(existing.id);
      } else if (opts.mode === 'event') {
        await pb.collection('favourites').create({
          user: pb.authStore.model.id, tournament: null, event_name: opts.eventName,
        });
      } else {
        await pb.collection('favourites').create({
          user: pb.authStore.model.id, tournament: opts.tournamentId, event_name: null,
        });
      }
      TournamentPage.favourites = await TournamentPage._loadFavourites();
      TournamentPage._renderFollowControl(opts);
    } catch (e) {
      console.error('TournamentPage._toggleFollow failed', e);
    }
  },


  _showError(msg) {
    document.getElementById('tourn-title').textContent = 'Tournament';
    document.getElementById('tourn-body').style.display = 'none';
    const banner = document.getElementById('tourn-error');
    document.getElementById('tourn-error-msg').textContent = msg;
    banner.classList.add('visible');
  },
};

document.addEventListener('DOMContentLoaded', () => {
  TournamentPage.init().catch(e => console.error('TournamentPage.init failed', e));
});
