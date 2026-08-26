/**
 * =============================================================================
 * admin.js — pb_public/assets/js/admin.js
 *
 * Admin-only operational dashboard: pending setup actions, today's scheduled
 * games, and recent results across every tournament. Read-only summary that
 * links into the EXISTING admin screens (index.html's setup wizard / roster
 * screen / fixtures screen / score modal) rather than duplicating any of
 * that logic — this page adds visibility, it doesn't replace anything.
 *
 * Uses the shared pb client + Auth from auth.js (loaded before this file),
 * same pattern as courts.js/users.js.
 *
 * Depends on: config.js (escHtml), logger.js (Logger), auth.js (pb, Auth), shell.js (Shell)
 * =============================================================================
 */

const Admin = {

  tournaments : [],
  teamCounts  : {},

  async init() {
    await Shell.injectNav();
    Shell.renderAuthBar(pb);

    if (!Auth.isAdmin()) {
      document.getElementById('not-admin-notice').style.display = '';
      Logger.info('Admin.init blocked — not an admin');
      return;
    }
    document.getElementById('admin-body').style.display = '';

    try {
      await Admin.load();
    } catch (e) {
      Logger.error('Admin.init failed', { error: e.message });
    }
  },

  async load() {
    const [tournaments, teamRows, todayCandidates, recentResults] = await Promise.all([
      pb.collection('tournaments').getFullList({ sort: '-created', requestKey: null }),
      pb.collection('teams').getFullList({ fields: 'id,tournament', requestKey: null }),
      pb.collection('fixtures').getFullList({
        filter    : `status="scheduled" && is_bye=false && home_team!="" && away_team!="" && scheduled_start_time!=""`,
        sort      : '+scheduled_start_time',
        expand    : 'home_team,away_team,tournament',
        requestKey: null,
      }),
      pb.collection('fixtures').getList(1, 5, {
        filter    : `status="completed" && is_bye=false`,
        sort      : '-updated',
        expand    : 'home_team,away_team,winner,tournament',
        requestKey: null,
      }),
    ]);

    Admin.tournaments = tournaments;
    Admin.teamCounts   = {};
    teamRows.forEach(r => { Admin.teamCounts[r.tournament] = (Admin.teamCounts[r.tournament] || 0) + 1; });

    const todayGames = todayCandidates.filter(f =>
      new Date(f.scheduled_start_time).toDateString() === new Date().toDateString()
    );

    const pending = tournaments.filter(t => t.status === 'pending');

    Admin._renderStats(tournaments, todayGames, pending);
    Admin._renderPending(pending);
    Admin._renderToday(todayGames);
    Admin._renderRecent(recentResults.items);
  },

  _renderStats(tournaments, todayGames, pending) {
    const active = tournaments.filter(t => t.status === 'active').length;
    document.getElementById('admin-stats-row').innerHTML = `
      <div class="stat-box"><div class="stat-val">${active}</div><div class="stat-lbl">Active</div></div>
      <div class="stat-box"><div class="stat-val">${todayGames.length}</div><div class="stat-lbl">Games today</div></div>
      <div class="stat-box"><div class="stat-val">${pending.length}</div><div class="stat-lbl">Needs attention</div></div>
    `;
  },

  // Every "pending" tournament needs either teams or fixtures before it can
  // go live — this just tells the admin which, it doesn't perform the
  // action itself. Clicking through lands on the existing home screen
  // where Resume/Open already handle it exactly as before.
  _renderPending(pending) {
    const el = document.getElementById('admin-pending-list');
    if (!pending.length) {
      el.innerHTML = `<div class="empty-state" style="padding:1.5rem 0;">
        <span class="empty-icon">✅</span>Nothing waiting on setup — every tournament is either active or complete.
      </div>`;
      return;
    }

    el.innerHTML = pending.map(t => {
      const count = Admin.teamCounts[t.id] || 0;
      const label = count === 0
        ? 'No teams registered yet'
        : `${count} team${count === 1 ? '' : 's'} registered — ready to generate fixtures once enough are in`;
      return `<div class="match-card">
        <span class="team-a" style="text-align:left;flex:1;">
          <strong>${escHtml(t.event_name || t.name)}</strong>
          <span style="color:var(--text-tertiary);font-weight:400;"> · ${escHtml(t.name)}</span>
        </span>
        <span class="match-action" style="min-width:auto;">${escHtml(label)}</span>
        <a class="btn sm ghost" href="index.html">Open →</a>
      </div>`;
    }).join('');
  },

  _renderToday(games) {
    const el = document.getElementById('admin-today-list');
    if (!games.length) {
      el.innerHTML = `<div class="empty-state" style="padding:1.5rem 0;">
        <span class="empty-icon">📅</span>No games with a scheduled time fall today.
      </div>`;
      return;
    }

    el.innerHTML = games.map(f => {
      const home = f.expand?.home_team?.name || 'TBD';
      const away = f.expand?.away_team?.name || 'TBD';
      const tName = f.expand?.tournament?.name || '';
      const time = new Date(f.scheduled_start_time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      return `<div class="match-card">
        <span class="match-num">${escHtml(time)}</span>
        <span class="team-a">${escHtml(home)}</span>
        <span class="vs">vs</span>
        <span class="team-b">${escHtml(away)}</span>
        <span class="match-action" style="min-width:auto;color:var(--text-tertiary);">${escHtml(tName)}</span>
      </div>`;
    }).join('');
  },

  _renderRecent(results) {
    const el = document.getElementById('admin-recent-list');
    if (!results.length) {
      el.innerHTML = `<div class="empty-state" style="padding:1.5rem 0;">
        <span class="empty-icon">🏀</span>No results recorded yet.
      </div>`;
      return;
    }

    el.innerHTML = results.map(f => {
      const home  = f.expand?.home_team?.name || 'TBD';
      const away  = f.expand?.away_team?.name || 'TBD';
      const tName = f.expand?.tournament?.name || '';
      const wHome = f.winner === f.home_team;
      const wAway = f.winner === f.away_team;
      return `<div class="match-card completed">
        <span class="team-a ${wHome ? 'winner-bold' : ''}">${escHtml(home)}</span>
        <span class="vs">vs</span>
        <span class="team-b ${wAway ? 'winner-bold' : ''}">${escHtml(away)}</span>
        <span class="match-score">${f.home_score} – ${f.away_score}</span>
        <span class="match-action" style="min-width:auto;color:var(--text-tertiary);">${escHtml(tName)}</span>
      </div>`;
    }).join('');
  },

};

document.addEventListener('DOMContentLoaded', () => {
  Admin.init().catch(e => Logger.error('Admin.init failed', { error: e.message }));
});
