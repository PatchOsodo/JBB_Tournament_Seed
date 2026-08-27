/**
 * =============================================================================
 * tournaments.js — pb_public/assets/js/tournaments.js
 *
 * Public tournament discovery page. Self-contained (own pb client) — no
 * dependency on app.js/db.js/state.js, same pattern as teams.js/stats.js.
 * Multi-category events (same event_name across several tournament records)
 * are collapsed into ONE card, per the audit's card-density requirement.
 *
 * ASSUMPTION: a grouped event's "View Tournament" button links to whichever
 * single category is most relevant (active > pending > completed), because
 * no category-picker screen exists yet. Revisit if that's wrong.
 *
 * Depends on: config.js (escHtml), shell.js (Shell)
 * =============================================================================
 */

const pb = new PocketBase(CONFIG.API_BASE_URL);

const AGE_ORDER = ['U10','U12','U13','U14','U16','U19','Senior','Open'];

const TournamentsPage = {

  groups : [],   // one entry per event (or per standalone tournament)
  filter : 'all',

  async init() {
    await Shell.injectNav();
    Shell.renderAuthBar(pb);

    try {
      const [tournaments, teamRows] = await Promise.all([
        pb.collection('tournaments').getFullList({ sort: '-created', requestKey: null }),
        pb.collection('teams').getFullList({ fields: 'id,tournament', requestKey: null }),
      ]);

      const teamCounts = {};
      teamRows.forEach(r => { teamCounts[r.tournament] = (teamCounts[r.tournament] || 0) + 1; });

      TournamentsPage.groups = TournamentsPage._buildGroups(tournaments, teamCounts);
      TournamentsPage.render();
    } catch (e) {
      console.error('TournamentsPage.init failed', e);
      document.getElementById('tournaments-grid').innerHTML = `<div class="empty-state">
        <span class="empty-icon">⚠️</span>Could not load tournaments: ${escHtml(e.message)}
      </div>`;
    }
  },

  // Groups tournaments by event_name; a tournament with no event_name is
  // its own single-tournament group — same rule App.loadTournaments() uses.
  _buildGroups(tournaments, teamCounts) {
    const byEvent    = {};
    const standalone = [];

    tournaments.forEach(t => {
      const ev = (t.event_name || '').trim();
      if (ev) {
        if (!byEvent[ev]) byEvent[ev] = [];
        byEvent[ev].push(t);
      } else {
        standalone.push(t);
      }
    });

    const groups = [];
    Object.entries(byEvent).forEach(([eventName, cats]) => {
      groups.push(TournamentsPage._makeGroup(eventName, cats, teamCounts));
    });
    standalone.forEach(t => {
      groups.push(TournamentsPage._makeGroup(t.event_name || t.name, [t], teamCounts));
    });

    groups.sort((a, b) => b.latestUpdated - a.latestUpdated);
    return groups;
  },

  _makeGroup(displayName, tournamentsInGroup, teamCounts) {
    const allDone   = tournamentsInGroup.every(t => t.status === 'completed');
    const anyActive = tournamentsInGroup.some(t => t.status === 'active');
    const status    = allDone ? 'completed' : anyActive ? 'active' : 'pending';

    const ageGroups = [...new Set(tournamentsInGroup.map(t => t.age_group).filter(Boolean))]
      .sort((a, b) => AGE_ORDER.indexOf(a) - AGE_ORDER.indexOf(b));

    const teamCount = tournamentsInGroup.reduce((sum, t) => sum + (teamCounts[t.id] || 0), 0);

    const bannerOwner = tournamentsInGroup.find(t => t.banner_image) || null;

    // See file header — active > pending > completed for the link target.
    const priority = { active: 0, pending: 1, completed: 2 };
    const linkTarget = [...tournamentsInGroup].sort(
      (a, b) => (priority[a.status] ?? 3) - (priority[b.status] ?? 3)
    )[0];

    const latestUpdated = Math.max(...tournamentsInGroup.map(t => new Date(t.updated).getTime()));

    return {
      displayName,
      status,
      ageGroups,
      teamCount,
      categoryCount : tournamentsInGroup.length,
      bannerOwner,
      linkId        : linkTarget.id,
      latestUpdated,
    };
  },

  setFilter(status, btnEl) {
    TournamentsPage.filter = status;
    document.querySelectorAll('#tournaments-filter .tab').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    TournamentsPage.render();
  },

  filterBySearch() { TournamentsPage.render(); },

  render() {
    const grid   = document.getElementById('tournaments-grid');
    const search = (document.getElementById('tournaments-search')?.value || '').toLowerCase();

    let filtered = TournamentsPage.filter === 'all'
      ? TournamentsPage.groups
      : TournamentsPage.groups.filter(g => g.status === TournamentsPage.filter);

    if (search) filtered = filtered.filter(g => g.displayName.toLowerCase().includes(search));

    if (!filtered.length) {
      grid.innerHTML = `<div class="empty-state">
        <span class="empty-icon">🏆</span>
        ${search ? `No tournaments matching "${escHtml(search)}".` : 'Nothing to show for this filter yet.'}
      </div>`;
      return;
    }

    grid.innerHTML = `<div class="tournament-grid">${filtered.map(TournamentsPage._card).join('')}</div>`;
  },

  _statusLabel(status) {
    return { pending: 'Upcoming', active: 'Ongoing', completed: 'Complete' }[status] || status;
  },

  _card(g) {
    const bannerHtml = g.bannerOwner
      ? `<img class="tournament-card-banner" src="${pb.files.getURL(g.bannerOwner, g.bannerOwner.banner_image, { thumb: '800x300' })}" alt="">`
      : `<div class="tournament-card-banner tournament-card-banner-placeholder"><span>🏀</span></div>`;

    const MAX_BADGES = 3;
    const shown = g.ageGroups.slice(0, MAX_BADGES);
    const extra = g.ageGroups.length - shown.length;
    const catBadges = g.ageGroups.length
      ? shown.map(a => `<span class="cat-badge">${escHtml(a)}</span>`).join('') +
        (extra > 0 ? `<span class="cat-badge">+${extra}</span>` : '')
      : `<span class="cat-badge cat-badge-format">${g.categoryCount} categor${g.categoryCount === 1 ? 'y' : 'ies'}</span>`;

    return `<div class="tournament-card">
      ${bannerHtml}
      <div class="tournament-card-body">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <span style="font-size:14px;font-weight:600;color:var(--text-primary);">${escHtml(g.displayName)}</span>
          <span class="status-badge badge-${g.status}">${TournamentsPage._statusLabel(g.status)}</span>
        </div>
        <div class="tournament-card-badges">${catBadges}</div>
        <div style="font-size:12px;color:var(--text-tertiary);margin-top:4px;">
          ${g.teamCount} team${g.teamCount === 1 ? '' : 's'} · ${g.categoryCount} categor${g.categoryCount === 1 ? 'y' : 'ies'}
        </div>
        <div class="tournament-card-actions">
          <a class="btn sm primary" href="tournament.html?id=${g.linkId}" style="width:100%;justify-content:center;">
            View Tournament
          </a>
        </div>
      </div>
    </div>`;
  },
};

document.addEventListener('DOMContentLoaded', () => {
  TournamentsPage.init().catch(e => console.error('TournamentsPage.init failed', e));
});
