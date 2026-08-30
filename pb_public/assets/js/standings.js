/**
 * =============================================================================
 * standings.js — pb_public/assets/js/standings.js
 *
 * Public, read-only standings for a single tournament.
 *
 * IMPORTANT — this does NOT invent new ranking rules. _computeStandings()
 * below is a direct port of generators.js's _computeGroupStandings(): same
 * fields (played/wins/losses/ptsFor/ptsAgainst/pointDiff), same sort order
 * (wins desc, then point diff desc, then points-for desc). It's copied
 * rather than imported so this page can stay self-contained (own pb client,
 * no db.js/state.js/generators.js/Logger dependency chain), the same
 * pattern as tournament.js/fixtures.js/results.js. If the ranking rule ever
 * changes, it must change in BOTH places — generators.js (admin) and here.
 *
 * Format handling:
 *   - group_stage : one table per group, top 2 marked as advancing — same
 *                   rule DB.seedKnockoutFromGroups() already relies on.
 *   - round_robin : one table, whole tournament as a single group. This is
 *                   a real gap being filled — no standings view for
 *                   round_robin tournaments exists anywhere else in the app.
 *   - elimination : no table. A single-elimination bracket doesn't have
 *                   "standings" in the sense a league table does — showing
 *                   one would be inventing a ranking rule that doesn't
 *                   exist. Points to Bracket instead.
 *
 * URL: standings.html?id=<tournament id>
 *
 * Depends on: config.js (escHtml), shell.js (Shell)
 * =============================================================================
 */

const pb = new PocketBase(CONFIG.API_BASE_URL);

// Direct port of generators.js's _computeGroupStandings — see file header.
// groupName === null means "whole tournament, no group split" (round_robin).
function _computeStandings(fixtures, teams, groupName) {
  const scopedFx = groupName
    ? fixtures.filter(f => f.group_name === groupName && !f.is_bye)
    : fixtures.filter(f => !f.group_name && !f.is_bye);

  if (!scopedFx.length) return [];

  const resolveId = (val) => {
    if (!val) return null;
    if (typeof val === 'object') return val.id ?? null;
    return val;
  };

  const teamIdsInScope = new Set();
  scopedFx.forEach(f => {
    const hId = resolveId(f.home_team);
    const aId = resolveId(f.away_team);
    if (hId) teamIdsInScope.add(hId);
    if (aId) teamIdsInScope.add(aId);
  });

  const standingsMap = {};
  teamIdsInScope.forEach(id => {
    const teamRecord = teams.find(t => t.id === id);
    const fullName = teamRecord?.name || `Team (${id.slice(0, 6)})`;
    standingsMap[id] = {
      teamId     : id,
      name       : teamRecord?.expand?.master_team?.short_name || fullName,
      fullName,
      played     : 0,
      wins       : 0,
      losses     : 0,
      ptsFor     : 0,
      ptsAgainst : 0,
      get pointDiff() { return this.ptsFor - this.ptsAgainst; },
    };
  });

  scopedFx.filter(f => f.status === 'completed').forEach(f => {
    const home = standingsMap[resolveId(f.home_team)];
    const away = standingsMap[resolveId(f.away_team)];
    if (!home || !away) return;

    home.played++; away.played++;
    home.ptsFor += (f.home_score || 0); home.ptsAgainst += (f.away_score || 0);
    away.ptsFor += (f.away_score || 0); away.ptsAgainst += (f.home_score || 0);

    if ((f.home_score || 0) > (f.away_score || 0)) { home.wins++; away.losses++; }
    else                                             { away.wins++; home.losses++; }
  });

  return Object.values(standingsMap).sort((a, b) => {
    if (b.wins !== a.wins)           return b.wins - a.wins;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
    return b.ptsFor - a.ptsFor;
  });
}

const StandingsPage = {

  tournament : null,
  fixtures   : [],
  teams      : [],

  async init() {
    await Shell.injectNav();
    Shell.renderAuthBar(pb);

    const params = new URLSearchParams(window.location.search);
    const id     = params.get('id');

    if (!id) {
      StandingsPage._showError('No tournament ID in the URL. Open this page from a tournament overview.');
      return;
    }

    try {
      const [tournament, teams, fixtures] = await Promise.all([
        pb.collection('tournaments').getOne(id),
        pb.collection('teams').getFullList({ filter: `tournament="${id}"`, expand: 'master_team', requestKey: null }),
        pb.collection('fixtures').getFullList({
          filter    : `tournament="${id}"`,
          sort      : 'round,match_number',
          requestKey: null,
        }),
      ]);

      StandingsPage.tournament = tournament;
      StandingsPage.teams      = teams;
      StandingsPage.fixtures   = fixtures;

      StandingsPage._renderHeader(id);
      StandingsPage._renderTables();

    } catch (e) {
      console.error('StandingsPage.init failed', e);
      StandingsPage._showError(`Could not load standings: ${e.message}`);
    }
  },

  _renderHeader(id) {
    const t = StandingsPage.tournament;
    document.getElementById('st-title').textContent = t.event_name || t.name;
    document.title = `Standings — ${t.event_name || t.name} | Junior Ballers 254`;

    const metaParts = [t.name, t.format.replace(/_/g, ' ')];
    if (t.age_group || t.gender) metaParts.push([t.age_group, t.gender].filter(Boolean).join(' '));
    document.getElementById('st-meta').textContent = metaParts.filter(Boolean).join(' · ');

    const tagEl = document.getElementById('st-tag');
    if (tagEl) tagEl.innerHTML = tournamentTagHtml(t);

    Shell.renderCategoryNav('st-nav', id, 'standings');
  },

  _renderTables() {
    const wrap = document.getElementById('st-tables');
    const t    = StandingsPage.tournament;

    if (t.format === 'elimination') {
      wrap.innerHTML = `<div class="empty-state">
        <span class="empty-icon">🏆</span>
        Standings don't apply to a single-elimination bracket — every team's
        result is a win-or-out match, not a table position.
        <br><br>
        <a class="btn sm primary" href="bracket.html?id=${t.id}">View the bracket instead →</a>
      </div>`;
      return;
    }

    if (t.format === 'group_stage') {
      const groupNames = [...new Set(
        StandingsPage.fixtures.filter(f => f.group_name).map(f => f.group_name)
      )].sort();

      if (!groupNames.length) {
        wrap.innerHTML = `<div class="empty-state"><span class="empty-icon">⏳</span>No group data yet.</div>`;
        return;
      }

      wrap.innerHTML = groupNames.map(gName => {
        const rows = _computeStandings(StandingsPage.fixtures, StandingsPage.teams, gName);
        return StandingsPage._table(gName, rows, true);
      }).join('');
      return;
    }

    // round_robin — whole tournament is one implicit group, no "advances" marker
    const rows = _computeStandings(StandingsPage.fixtures, StandingsPage.teams, null);
    if (!rows.length) {
      wrap.innerHTML = `<div class="empty-state"><span class="empty-icon">⏳</span>No standings yet — check back once games are underway.</div>`;
      return;
    }
    wrap.innerHTML = StandingsPage._table(null, rows, false);
  },

  // Small gold/silver/bronze circle for the top 3 — same palette already
  // used elsewhere in the app (placementBadge in stats.js/app.js/teams.js),
  // so a 1st/2nd/3rd cue reads consistently across pages.
  _rankBadge(rank) {
    const bg  = rank === 1 ? '#fef3c7' : rank === 2 ? '#f1f5f9' : '#fef3c7';
    const col = rank === 1 ? '#f59e0b' : rank === 2 ? '#94a3b8' : '#b45309';
    return `<span style="display:inline-flex;align-items:center;justify-content:center;
                         width:20px;height:20px;border-radius:50%;font-size:11px;
                         font-weight:700;background:${bg};color:${col};">${rank}</span>`;
  },

  // Same table markup/inline styling as the admin app's _renderGroupStandings
  // in app.js, for visual consistency between the admin and public views.
  _table(groupLabel, rows, showAdvancing) {
    const tableRows = rows.map((s, i) => {
      const adv  = showAdvancing && i < 2;
      const rank = i + 1;
      return `<tr style="${adv ? 'background:var(--bg-success)' : ''}">
        <td style="padding:6px 8px;font-size:12px;font-weight:500;
                   color:${adv ? 'var(--accent)' : 'var(--text-secondary)'}">
          ${rank <= 3 ? StandingsPage._rankBadge(rank) : rank}${adv ? ' ✓' : ''}
        </td>
        <td style="padding:6px 8px;font-size:13px;font-weight:${adv ? '600' : '400'}"
            ${s.fullName && s.fullName !== s.name ? `title="${escHtml(s.fullName)}"` : ''}>
          ${escHtml(s.name)}
        </td>
        <td style="padding:6px 8px;font-size:12px;text-align:center">${s.played}</td>
        <td style="padding:6px 8px;font-size:12px;text-align:center;font-weight:600;
                   color:var(--accent)">${s.wins}</td>
        <td style="padding:6px 8px;font-size:12px;text-align:center">${s.losses}</td>
        <td style="padding:6px 8px;font-size:12px;text-align:center;
                   color:${s.pointDiff >= 0 ? 'var(--accent)' : 'var(--danger)'}">
          ${s.pointDiff >= 0 ? '+' : ''}${s.pointDiff}
        </td>
      </tr>`;
    }).join('');

    return `<div class="round-section">
      <div class="round-label">${groupLabel ? escHtml(groupLabel) : 'Standings'}
        ${showAdvancing ? '<span style="font-size:10px;color:var(--text-tertiary);font-style:italic"> ✓ advances</span>' : ''}
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;background:var(--bg-primary);
                      border-radius:var(--radius-md);overflow:hidden;
                      border:0.5px solid var(--border-light)">
          <thead>
            <tr style="background:var(--bg-secondary)">
              <th style="padding:6px 8px;font-size:10px;font-weight:500;color:var(--text-tertiary);text-align:left">#</th>
              <th style="padding:6px 8px;font-size:10px;font-weight:500;color:var(--text-tertiary);text-align:left">Team</th>
              <th style="padding:6px 8px;font-size:10px;font-weight:500;color:var(--text-tertiary);text-align:center">P</th>
              <th style="padding:6px 8px;font-size:10px;font-weight:500;color:var(--text-tertiary);text-align:center">W</th>
              <th style="padding:6px 8px;font-size:10px;font-weight:500;color:var(--text-tertiary);text-align:center">L</th>
              <th style="padding:6px 8px;font-size:10px;font-weight:500;color:var(--text-tertiary);text-align:center">+/-</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>`;
  },

  _showError(msg) {
    document.getElementById('st-title').textContent = 'Standings';
    document.getElementById('st-body').style.display = 'none';
    const banner = document.getElementById('st-error');
    document.getElementById('st-error-msg').textContent = msg;
    banner.classList.add('visible');
  },
};

document.addEventListener('DOMContentLoaded', () => {
  StandingsPage.init().catch(e => console.error('StandingsPage.init failed', e));
});
