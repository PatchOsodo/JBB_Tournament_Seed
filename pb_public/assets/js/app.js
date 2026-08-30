/**
 * =============================================================================
 * app.js — Guest-facing home page controller.
 *
 * Everything admin-authoring (create/roster/generate/deadline/banner/manage
 * teams/regenerate/results/organise/delete) has moved to manage.js —
 * reachable only from admin.html, never from this page. This file renders
 * identically for a guest and a super_admin.
 *
 * Depends on: config.js, logger.js, auth.js, state.js, events.js, db.js
 * =============================================================================
 */

const App = {

  async init() {
    Logger.info('App.init', { version: CONFIG.VERSION });

    const user = Auth.user();
    Logger.info('Auth state', { loggedIn: !!user, role: Auth.role(), email: user?.email ?? '(guest)' });

    try {
      await Shell.injectNav();
      Shell.renderAuthBar(pb);
    } catch (e) {
      Logger.error('Shell init failed — nav will be missing', { error: e.message });
    }

    const online = await DB.healthCheck();
    UI.setConnectionStatus(online);
    if (!online) {
      UI.showError('home-error', 'home-error-msg',
        "We're having trouble reaching the tournament server. Some information may not load — please check your connection and try again.");
    }

    await App.loadTournaments();
    App._loadHeroContent();
    App._initScrollFadeIn();
  },

  async _loadHeroContent() {
    try {
      const [teamsCount, categoriesCount, matchesCount] = await Promise.all([
        pb.collection('master_teams').getList(1, 1, { requestKey: null }),
        pb.collection('tournaments').getList(1, 1, { requestKey: null }),
        pb.collection('fixtures').getList(1, 1, { filter: `status="completed"`, requestKey: null }),
      ]);
      const banner = document.getElementById('hero-stats-banner');
      if (banner) {
        banner.innerHTML = `<div class="stats-banner">
          <div class="stats-banner-item"><div class="stat-value">${teamsCount.totalItems}</div><div class="stat-label">Teams</div></div>
          <div class="stats-banner-item"><div class="stat-value">${categoriesCount.totalItems}</div><div class="stat-label">Categories</div></div>
          <div class="stats-banner-item"><div class="stat-value">${matchesCount.totalItems}</div><div class="stat-label">Matches played</div></div>
        </div>`;
      }
    } catch (e) {
      Logger.warn('_loadHeroContent stats failed', { error: e.message });
    }

    App._loadFeaturedTournament();
    App._loadOtherActiveTournaments();
    App._loadActivityTeaser();
    App._loadRecentChampions();
  },

  async _loadFeaturedTournament() {
    const el = document.getElementById('hero-featured-tournament');
    if (!el) return;
    const tournaments = State.tournaments || [];
    if (!tournaments.length) return;

    const active = tournaments.filter(t => t.status === 'active');
    const pool = active.length ? active : tournaments.filter(t => t.status === 'pending');
    if (!pool.length) return;

    const groups = Events.groupByEventName(pool);
    const [, bestGroup] = Events.sortGroupsByRelevance(groups)[0];

    const displayName = bestGroup[0].event_name || bestGroup[0].name;
    const categoryCount = bestGroup.length;
    const teamCount = bestGroup.reduce((sum, t) => sum + (State.teamCounts?.[t.id] || 0), 0);

    let gameCount = 0;
    try {
      const filter = bestGroup.map(t => `tournament="${t.id}"`).join('||');
      const res = await pb.collection('fixtures').getList(1, 1, { filter: `(${filter})&&is_bye=false`, requestKey: null });
      gameCount = res.totalItems;
    } catch (e) {
      Logger.warn('_loadFeaturedTournament: fixture count failed', { error: e.message });
    }

    const linkHref = bestGroup.length === 1
      ? `bracket.html?id=${bestGroup[0].id}`
      : `tournament.html?event=${encodeURIComponent(displayName)}`;
    const statusLabel = active.length ? 'Ongoing' : 'Coming up';

    const bannerOwner = bestGroup.find(t => t.banner_image) || null;
    const bannerStyle = bannerOwner
      ? `style="background-image:url('${pb.files.getURL(bannerOwner, bannerOwner.banner_image, { thumb: '1200x360' })}')"`
      : '';

    // No standings preview here — a ranking table is inherently relational
    // (1st place only means something once you know the pool), so it
    // needs tournament context the homepage visitor doesn't have yet.
    // Lives on tournament.html/standings.html instead.
    el.innerHTML = `
      <div class="featured-tournament-card">
        <div class="featured-tournament-eyebrow">${escHtml(statusLabel)}</div>
        <div class="featured-tournament-name">${escHtml(displayName)}</div>
        <div class="featured-tournament-stats">
          <div><span class="score-display-md">${teamCount}</span><span class="featured-stat-label">Teams</span></div>
          <div><span class="score-display-md">${categoryCount}</span><span class="featured-stat-label">Categor${categoryCount === 1 ? 'y' : 'ies'}</span></div>
          <div><span class="score-display-md">${gameCount}</span><span class="featured-stat-label">Games scheduled</span></div>
        </div>
        <a href="${linkHref}" class="btn primary featured-tournament-cta">Follow Tournament</a>
      </div>`;
  },

  _loadOtherActiveTournaments() {
    const el = document.getElementById('other-active-tournaments');
    if (!el) return;
    const active = (State.tournaments || []).filter(t => t.status === 'active');
    if (active.length < 2) return;

    const groups = Events.groupByEventName(active);
    const sorted = Events.sortGroupsByRelevance(groups);
    if (sorted.length < 2) return;

    const others = sorted.slice(1);
    el.innerHTML = `
      <div class="section-heading">Also Happening Now</div>
      <div class="other-active-rail">${others.map(([, group]) => App._otherActiveCard(group)).join('')}</div>`;
  },

  _otherActiveCard(group) {
    const displayName = group[0].event_name || group[0].name;
    const categoryCount = group.length;
    const teamCount = group.reduce((sum, t) => sum + (State.teamCounts?.[t.id] || 0), 0);
    const linkHref = group.length === 1
      ? `bracket.html?id=${group[0].id}`
      : `tournament.html?event=${encodeURIComponent(displayName)}`;
    return `<a href="${linkHref}" class="other-active-card">
      <div class="other-active-name">${escHtml(displayName)}</div>
      <div class="other-active-meta">${teamCount} team${teamCount === 1 ? '' : 's'} · ${categoryCount} categor${categoryCount === 1 ? 'y' : 'ies'}</div>
    </a>`;
  },
/**
  async _loadStandingsPreview(featuredTournament) {
    const el = document.getElementById('standings-preview-section');
    if (!el || !featuredTournament) return;
    if (featuredTournament.format === 'elimination') return;

    try {
      const [teams, fixtures] = await Promise.all([
        pb.collection('teams').getFullList({ filter: `tournament="${featuredTournament.id}"`, requestKey: null }),
        pb.collection('fixtures').getFullList({ filter: `tournament="${featuredTournament.id}"`, requestKey: null }),
      ]);
      if (!teams.length || !fixtures.length) return;

      let rows;
      if (featuredTournament.format === 'group_stage') {
        const groupNames = [...new Set(fixtures.filter(f => f.group_name).map(f => f.group_name))].sort();
        if (!groupNames.length) return;
        rows = _computeGroupStandings(fixtures, teams, groupNames[0]).slice(0, 5);
        if (!rows.length) return;
        el.dataset.groupLabel = groupNames[0];
      } else {
        rows = _computeGroupStandings(fixtures.map(f => ({ ...f, group_name: '__all__' })), teams, '__all__').slice(0, 5);
        if (!rows.length) return;
      }
      if (!rows.some(r => r.played > 0)) return;

      const tournamentLabel = featuredTournament.event_name || featuredTournament.name;
      const groupLabel = el.dataset.groupLabel ? ` — ${escHtml(el.dataset.groupLabel)}` : '';

      el.innerHTML = `
        <div class="section-heading">Standings</div>
        <div class="standings-preview-card">
          <div class="standings-preview-title">${escHtml(tournamentLabel)}${groupLabel}</div>
          <div style="overflow-x:auto;">
            <table class="standings-preview-table">
              <thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>+/-</th></tr></thead>
              <tbody>${rows.map((s, i) => `
                <tr>
                  <td class="standings-preview-rank ${i < 3 ? 'rank-' + (i + 1) : ''}">${i + 1}</td>
                  <td>${escHtml(s.name)}</td>
                  <td class="standings-preview-num standings-preview-wins">${s.wins}</td>
                  <td class="standings-preview-num">${s.losses}</td>
                  <td class="standings-preview-num" style="color:${s.pointDiff >= 0 ? 'var(--accent)' : 'var(--danger)'}">
                    ${s.pointDiff >= 0 ? '+' : ''}${s.pointDiff}
                  </td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <a href="stats.html" class="standings-preview-link">View full standings →</a>
        </div>`;
    } catch (e) {
      Logger.warn('_loadStandingsPreview failed', { error: e.message });
    }
  },

  async _loadUpcomingGames() {
    const section = document.getElementById('upcoming-games-section');
    if (!section) return;
    try {
      const games = await DB.getUpcomingGames(6);
      if (!games.length) { section.innerHTML = ''; return; }
      section.innerHTML = `
        <div class="upcoming-games-heading">📅 Upcoming games</div>
        <div class="upcoming-games-grid">${games.map(App._upcomingGameCard).join('')}</div>`;
    } catch (e) {
      Logger.warn('_loadUpcomingGames failed', { error: e.message });
    }
  },

  _upcomingGameCard(f) {
    const home = f.expand?.home_team?.name || 'TBD';
    const away = f.expand?.away_team?.name || 'TBD';
    const tournamentName = f.expand?.tournament?.name || '';
    const eventName = f.expand?.tournament?.event_name || '';
    const label = [eventName, tournamentName].filter(Boolean).join(' · ') || tournamentName;
    const when = f.scheduled_start_time
      ? new Date(f.scheduled_start_time).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '';
    return `<div class="upcoming-game-card">
      ${label ? `<div class="upcoming-game-meta">${escHtml(label)}</div>` : ''}
      <div class="upcoming-game-teams">
        <span>${escHtml(home)}</span><span class="upcoming-game-vs">vs</span><span>${escHtml(away)}</span>
      </div>
      ${when ? `<div class="upcoming-game-time">${escHtml(when)}</div>` : ''}
    </div>`;
  },

  async _loadHeroMatchSnippet() {
    const resultsEl = document.getElementById('latest-results-section');
    if (!resultsEl) return;
    try {
      const recent = await pb.collection('fixtures').getList(1, 5, {
        filter: `status="completed"`, sort: '-updated', expand: 'home_team,away_team,tournament', requestKey: null,
      });
      if (!recent.items.length) return;
      resultsEl.innerHTML = `
        <div class="section-heading">Latest Results</div>
        <div class="results-rail">${recent.items.map(App._resultCard).join('')}</div>`;
    } catch (e) {
      Logger.warn('_loadHeroMatchSnippet failed', { error: e.message });
    }
  },

  _resultCard(fx) {
    const home = fx.expand?.home_team?.name || 'Home';
    const away = fx.expand?.away_team?.name || 'Away';
    const catName = fx.expand?.tournament?.name || '';
    const wHome = fx.winner === fx.home_team;
    const wAway = fx.winner === fx.away_team;
    return `<div class="result-card">
      ${catName ? `<div class="result-category">${escHtml(catName)}</div>` : ''}
      <div class="result-row ${wHome ? 'result-winner' : ''}"><span class="result-team">${escHtml(home)}</span><span class="score-display-md">${fx.home_score}</span></div>
      <div class="result-row ${wAway ? 'result-winner' : ''}"><span class="result-team">${escHtml(away)}</span><span class="score-display-md">${fx.away_score}</span></div>
      <div class="result-final-tag">Final</div>
    </div>`;
  },**/

  // Single-item teaser — one soonest scheduled game, one most recent
  // result. Not a rail, not a dashboard: per the "if it needs tournament
  // context it doesn't belong on the landing page" rule, this only needs
  // to signal the site is live and hand off to the real page (fixtures/
  // results), never to summarize a tournament in place.
  async _loadActivityTeaser() {
    const el = document.getElementById('activity-teaser');
    if (!el) return;

    try {
      const [nextGame, lastResult] = await Promise.all([
        pb.collection('fixtures').getList(1, 1, {
          filter: `status="scheduled" && is_bye=false && home_team!="" && away_team!="" && scheduled_start_time!=""`,
          sort: '+scheduled_start_time',
          expand: 'home_team,away_team,tournament',
          requestKey: null,
        }),
        pb.collection('fixtures').getList(1, 1, {
          filter: `status="completed"`,
          sort: '-updated',
          expand: 'home_team,away_team,tournament',
          requestKey: null,
        }),
      ]);

      const next = nextGame.items[0] || null;
      const last = lastResult.items[0] || null;
      if (!next && !last) { el.innerHTML = ''; return; }

      el.innerHTML = `<div class="activity-teaser-grid">
      ${next ? App._activityCard('next', next) : ''}
      ${last ? App._activityCard('result', last) : ''}
      </div>`;
    } catch (e) {
      Logger.warn('_loadActivityTeaser failed', { error: e.message });
    }
  },

  _activityCard(kind, f) {
    const home = f.expand?.home_team?.name || 'TBD';
    const away = f.expand?.away_team?.name || 'TBD';
    const catName = f.expand?.tournament?.name || '';
    const linkHref = `${kind === 'next' ? 'fixtures' : 'results'}.html?id=${f.tournament}`;

    if (kind === 'next') {
      const when = f.scheduled_start_time
      ? new Date(f.scheduled_start_time).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '';
      return `<a href="${linkHref}" class="activity-card">
      <div class="activity-card-label">📅 Next up</div>
      <div class="activity-card-teams">${escHtml(home)} <span class="activity-card-vs">vs</span> ${escHtml(away)}</div>
      <div class="activity-card-meta">${escHtml(catName)}${when ? ' · ' + escHtml(when) : ''}</div>
      </a>`;
    }

    const wHome = f.winner === f.home_team;
    return `<a href="${linkHref}" class="activity-card">
    <div class="activity-card-label">🏀 Latest result</div>
    <div class="activity-card-teams">
    <span class="${wHome ? 'activity-winner' : ''}">${escHtml(home)}</span> ${f.home_score}
    <span class="activity-card-vs">–</span>
    ${f.away_score} <span class="${!wHome ? 'activity-winner' : ''}">${escHtml(away)}</span>
    </div>
    <div class="activity-card-meta">${escHtml(catName)}</div>
    </a>`;
  },

  async _loadRecentChampions() {
    const section = document.getElementById('recent-champions-section');
    if (!section) return;
    try {
      const champions = await pb.collection('team_stats').getList(1, 3, {
        filter: `placement=1`, sort: '-updated', expand: 'master_team,tournament', requestKey: null,
      });
      if (!champions.items.length) return;
      section.innerHTML = `
        <div class="champions-section">
          <div class="champions-heading">🏆 Recent champions</div>
          <div class="champions-grid">
            ${champions.items.map(c => {
              const team = c.expand?.master_team?.name || 'Unknown team';
              const cat = c.expand?.tournament?.name || '';
              return `<div class="champion-card"><span class="champion-medal">🥇</span>
                <div><div class="champion-team">${escHtml(team)}</div><div class="champion-meta">${escHtml(cat)}</div></div>
              </div>`;
            }).join('')}
          </div>
        </div>`;
    } catch (e) {
      Logger.warn('_loadRecentChampions failed', { error: e.message });
    }
  },

  _initScrollFadeIn() {
    const targets = document.querySelectorAll('.hero-fade-in');
    if (!targets.length || !('IntersectionObserver' in window)) {
      targets.forEach(t => t.classList.add('fade-in-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add('fade-in-visible'); observer.unobserve(entry.target); }
      });
    }, { threshold: 0.15 });
    targets.forEach(t => observer.observe(t));
  },

  /* ── HOME SCREEN — favourites + directory gateway, identical for everyone ── */

  async loadTournaments() {
    Logger.info('loadTournaments');
    UI.clearError('home-error');
    const list = document.getElementById('tournament-list');
    if (!list) return;
    list.innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>';

    try {
      const [tournaments, favourites, teamCounts] = await Promise.all([
        DB.getTournaments(), DB.getFavourites(), DB.getAllTeamCounts(),
      ]);
      State.favourites = favourites;
      State.teamCounts = teamCounts;
      State.tournaments = tournaments;

      if (!tournaments.length) {
        list.innerHTML = `<div class="empty-state"><span class="empty-icon">🏆</span>No tournaments on the board yet. Check back soon.</div>`;
        return;
      }

      let html = '';

      if (Auth.canFavourite() && State.favourites.length) {
        const favIds = new Set(State.favourites.map(f => typeof f.tournament === 'object' ? f.tournament.id : f.tournament));
        const favTournaments = tournaments.filter(t => favIds.has(t.id));
        if (favTournaments.length) {
          html += `
            <div style="margin-bottom:10px;">
              <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-tertiary);padding:0 0 6px 0;">⭐ Following</div>
              ${favTournaments.map(t => App._renderFavouriteItem(t)).join('')}
            </div>`;
        }
      }

      // Same gateway card for every visitor — the full Active/Upcoming/
      // Completed directory with Resume/Delete now lives only in
      // manage.html, reachable only from admin.html.
      html += `
        <div class="directory-gateway-card">
          <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:6px;">Browse every tournament</div>
          <p style="font-size:13px;color:var(--text-tertiary);margin-bottom:1rem;">Active, upcoming, and completed — all in one place.</p>
          <a href="tournaments.html" class="btn primary">Explore All Tournaments →</a>
        </div>`;

      list.innerHTML = html;

    } catch (e) {
      Logger.error('loadTournaments failed', { error: e.message });
      UI.showError('home-error', 'home-error-msg', `Could not load tournaments: ${e.message}`);
      list.innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span>Couldn\'t load tournaments right now — check your connection and try again.</div>';
    }
  },

  _statusLabel(status) { return { pending: 'Not yet started', active: 'Ongoing', completed: 'Complete' }[status] || status; },

  _renderFavouriteItem(t) {
    const formatText = t.format.replace(/_/g, ' ');
    const dateText = new Date(t.created).toLocaleDateString();
    const fav = State.favourites.find(f => (typeof f.tournament === 'object' ? f.tournament.id : f.tournament) === t.id);
    const favBtn = fav
      ? `<button class="btn sm ghost" title="Unfavourite" onclick="App.toggleFavourite('${t.id}','${fav.id}')">⭐</button>`
      : `<button class="btn sm ghost" title="Follow" onclick="App.toggleFavourite('${t.id}',null)">☆</button>`;

    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:0.85rem 1rem;border-bottom:0.5px solid var(--border-light);flex-wrap:wrap;gap:8px;">
        <div>
          <div style="font-size:14px;font-weight:500;color:var(--text-primary);">
            <a href="tournament.html?id=${t.id}" style="color:inherit;text-decoration:none;">${escHtml(t.name)}</a>
          </div>
          <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">${formatText} · ${dateText}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <span class="status-badge badge-${t.status}">${App._statusLabel(t.status)}</span>
          <a class="btn sm primary" href="tournament.html?id=${t.id}">Open</a>
          ${favBtn}
        </div>
      </div>`;
  },

  async toggleFavourite(tournamentId, existingFavouriteId) {
    try {
      if (existingFavouriteId) {
        await DB.removeFavourite(existingFavouriteId);
      } else {
        await DB.addFavourite(tournamentId);
      }
      await App.loadTournaments();
    } catch (e) {
      Logger.error('toggleFavourite failed', { error: e.message });
    }
  },

};

window.addEventListener('error', e => {
  Logger.error('Uncaught error', { message: e.message, file: e.filename, line: e.lineno });
});
window.addEventListener('unhandledrejection', e => {
  Logger.error('Unhandled promise rejection', { reason: String(e.reason) });
});

document.addEventListener('DOMContentLoaded', () => {
  Logger.info('DOM ready — booting guest home', { version: CONFIG.VERSION });
  if (document.getElementById('screen-home')) {
    App.init().catch(e => Logger.error('App.init failed', { error: e.message }));
  }
});
