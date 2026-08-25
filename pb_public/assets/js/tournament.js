/**
 * =============================================================================
 * tournament.js — pb_public/assets/js/tournament.js
 *
 * Public, read-only overview for a single tournament: header, quick stats,
 * recent results, and next-up games. Self-contained (own pb client), same
 * pattern as teams.js/stats.js — does not depend on db.js/state.js/app.js,
 * so it can never be affected by (or affect) the admin wizard flow.
 *
 * URL: tournament.html?id=<tournament id>
 *
 * CHANGES
 * -------
 * - Phase 5: nav strip now links to the new public Fixtures page
 *   (fixtures.html?id=...) instead of only Bracket/Teams registry.
 *
 * Depends on: config.js (escHtml), shell.js (Shell)
 * =============================================================================
 */

const pb = new PocketBase(CONFIG.API_BASE_URL);

const TournamentPage = {

    tournament : null,
    fixtures   : [],

    async init() {
        await Shell.injectNav();
        Shell.renderAuthBar(pb);

        const params = new URLSearchParams(window.location.search);
        const id     = params.get('id');

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
                                                                             expand    : 'home_team,away_team,winner',
                                                                             requestKey: null,
                                                                         }),
            ]);

            TournamentPage.tournament = tournament;
            TournamentPage.fixtures   = fixtures;

            TournamentPage._renderHeader();
            TournamentPage._renderNav(id);
            TournamentPage._renderStats(teamsCount.totalItems);
            TournamentPage._renderRecentResults();
            TournamentPage._renderNextUp();

        } catch (e) {
            console.error('TournamentPage.init failed', e);
            TournamentPage._showError(`Could not load this tournament: ${e.message}`);
        }
    },

    _renderHeader() {
        const t = TournamentPage.tournament;
        document.getElementById('tourn-title').textContent = t.event_name || t.name;

        const metaParts = [t.name, t.format.replace(/_/g, ' ')];
        if (t.age_group || t.gender) metaParts.push([t.age_group, t.gender].filter(Boolean).join(' '));
        document.getElementById('tourn-meta').textContent = metaParts.filter(Boolean).join(' · ');

        const badge = document.getElementById('tourn-status');
        const label = { pending: 'Not yet started', active: 'Ongoing', completed: 'Complete' }[t.status] || t.status;
        badge.textContent = label;
        badge.className   = `status-badge badge-${t.status}`;
    },

    _renderNav(id) {
        document.getElementById('tourn-nav').innerHTML = `
        <span class="btn sm primary" style="pointer-events:none;">Overview</span>
        <a class="btn sm ghost" href="fixtures.html?id=${id}">Fixtures</a>
        <a class="btn sm ghost" href="results.html?id=${id}">Results</a>
        <a class="btn sm ghost" href="standings.html?id=${id}">Standings</a>
        <a class="btn sm ghost" href="bracket.html?id=${id}">Bracket</a>
        <a class="btn sm ghost" href="teams.html">Teams registry</a>
        `;
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

    // Most recently decided matches, by actual last-updated time — a real
    // recency signal, not an assumption based on round order (round order
    // alone isn't chronological for round-robin/group formats).
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

    // Scheduled games with both teams already assigned (no TBD placeholders),
    // ordered by round/match order — for a single tournament's own page this
    // is a legitimate "what's next in the schedule" view, unlike the
    // homepage's cross-tournament teaser, which only trusts real clock times.
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

    // Reuses the app-wide .match-card look (same markup shape as
    // App._matchCard in app.js) so this page feels consistent, without
    // importing app.js's admin-oriented click-to-score behavior.
    _matchCard(f, isDone) {
        const home  = f.expand?.home_team?.name || 'TBD';
        const away  = f.expand?.away_team?.name || 'TBD';
        const wHome = isDone && f.winner === f.home_team;
        const wAway = isDone && f.winner === f.away_team;
        const when  = f.scheduled_start_time
        ? new Date(f.scheduled_start_time).toLocaleString(undefined, {
            weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        })
        : (f.scheduled_time || f.round_label || `Round ${f.round}`);

        return `<div class="match-card ${isDone ? 'completed' : ''}">
        <span class="match-num">${escHtml(f.round_label || `R${f.round}`)}</span>
        <span class="team-a ${wHome ? 'winner-bold' : ''}">${escHtml(home)}</span>
        <span class="vs">vs</span>
        <span class="team-b ${wAway ? 'winner-bold' : ''}">${escHtml(away)}</span>
        ${isDone
            ? `<span class="match-score">${f.home_score} – ${f.away_score}</span>`
            : `<span class="match-timecourt-chip">${escHtml(when)}</span>`}
            </div>`;
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
