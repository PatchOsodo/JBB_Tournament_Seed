/**
 * =============================================================================
 * courts.js — Admin-only court assignment: a "Court 1: Match A → Match B"
 * queue-order view per court, no fixed times (that's Phase 2 / Tier 3).
 *
 * Depends on: config.js, logger.js, auth.js (shared pb + Auth)
 * =============================================================================
 */

const Courts = {
  tournaments : [],
  venues      : [],
  courts      : [],
  fixtures    : [],
  currentTournamentId: null,

  async init() {
      await Shell.injectNav();
      Shell.renderAuthBar(pb);
      if (!Auth.isAdmin()) {
        document.getElementById('not-admin-notice').style.display = '';
        Logger.info('Courts.init blocked — not an admin');
        return;
      }
      document.getElementById('courts-page-body').style.display = '';

    try {
      Courts.tournaments = await pb.collection('tournaments').getFullList({
        sort: '-created', fields: 'id,name,status',
      });
      const picker = document.getElementById('courts-tournament-picker');
      if (!Courts.tournaments.length) {
        picker.innerHTML = '<option value="">No tournaments yet</option>';
        return;
      }
      picker.innerHTML = Courts.tournaments.map(t => `<option value="${t.id}">${_esc(t.name)}</option>`).join('');
      Courts.currentTournamentId = Courts.tournaments[0].id;
      await Courts.load();
    } catch (e) {
      Logger.error('Courts.init failed', { error: e.message });
      UI.showError('courts-error', 'courts-error-msg', `Could not load tournaments: ${e.message}`);
    }
  },

  onTournamentChange() {
    Courts.currentTournamentId = document.getElementById('courts-tournament-picker').value;
    Courts.load();
  },

  async load() {
    if (!Courts.currentTournamentId) return;
    try {
      [Courts.venues, Courts.courts, Courts.fixtures] = await Promise.all([
        DB.getVenues(Courts.currentTournamentId),
        DB.getCourts(Courts.currentTournamentId),
        DB.getFixtures(Courts.currentTournamentId),
      ]);
      Logger.info('Courts.load', { venues: Courts.venues.length, courts: Courts.courts.length, fixtures: Courts.fixtures.length });
      Courts.render();
    } catch (e) {
      Logger.error('Courts.load failed', { error: e.message });
      UI.showError('courts-error', 'courts-error-msg', `Could not load courts: ${e.message}`);
    }
  },

  async addVenue() {
    const nameEl  = document.getElementById('new-venue-name');
    const countEl = document.getElementById('new-venue-court-count');
    const name    = nameEl.value.trim();
    const count   = parseInt(countEl.value, 10) || 1;
    if (!name || !Courts.currentTournamentId) return;
    try {
      await DB.createVenue(Courts.currentTournamentId, name, count);
      nameEl.value = '';
      countEl.value = '1';
      await Courts.load();
    } catch (e) {
      Logger.error('Courts.addVenue failed', { error: e.message });
      UI.showError('courts-error', 'courts-error-msg', `Could not add venue: ${e.message}`);
    }
  },

  async toggleCourtActive(courtId, currentlyActive) {
    try {
      await DB.setCourtActive(courtId, !currentlyActive);
      await Courts.load();
    } catch (e) {
      Logger.error('Courts.toggleCourtActive failed', { error: e.message });
    }
  },

  async assignFixture(fixtureId, courtId) {
    try {
      await DB.assignFixtureCourt(fixtureId, courtId);
      await Courts.load();
    } catch (e) {
      Logger.error('Courts.assignFixture failed', { error: e.message });
      alert(`Couldn't reassign: ${e.message}`);
    }
  },

  async setSchedule(fixtureId, dateInputEl, durationInputEl) {
    const localVal = dateInputEl.value; // "YYYY-MM-DDTHH:mm", local time, or ""
    const startIso = localVal ? new Date(localVal).toISOString() : null;
    const duration = durationInputEl.value ? parseInt(durationInputEl.value, 10) : null;
    try {
      await DB.setFixtureSchedule(fixtureId, startIso, duration);
      await Courts.load();
    } catch (e) {
      Logger.error('Courts.setSchedule failed', { error: e.message });
      alert(`Couldn't save schedule: ${e.message}`);
    }
  },

  _teamName(fixture, side) {
    return teamDisplayName(fixture.expand?.[side]);
  },

  _courtSelect(fixture) {
    const options = [`<option value="">— Unassigned —</option>`]
      .concat(Courts.courts.map(c =>
        `<option value="${c.id}" ${fixture.court === c.id ? 'selected' : ''}>${_esc(c.court_name)}</option>`
      ));
    return `<select onchange="Courts.assignFixture('${fixture.id}', this.value)">${options.join('')}</select>`;
  },

  // "YYYY-MM-DDTHH:mm" for a <input type="datetime-local">, from a stored
  // UTC ISO string, in the browser's local time.
  _toLocalInputValue(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  // Non-blocking conflict check: does this fixture's [start, start+duration]
  // window overlap another fixture ON THE SAME COURT? Per the confirmed
  // decision, this warns only — nothing here prevents saving.
  _overlapWarning(fixture) {
    if (!fixture.court || !fixture.scheduled_start_time || !fixture.estimated_duration_minutes) return '';
    const start = new Date(fixture.scheduled_start_time).getTime();
    const end   = start + fixture.estimated_duration_minutes * 60000;

    const conflict = Courts.fixtures.find(other => {
      if (other.id === fixture.id) return false;
      if (other.court !== fixture.court) return false;
      if (!other.scheduled_start_time || !other.estimated_duration_minutes) return false;
      const oStart = new Date(other.scheduled_start_time).getTime();
      const oEnd   = oStart + other.estimated_duration_minutes * 60000;
      return start < oEnd && oStart < end; // ranges overlap
    });

    if (!conflict) return '';
    const home = Courts._teamName(conflict, 'home_team');
    const away = Courts._teamName(conflict, 'away_team');
    return `<div style="color:var(--text-warning);font-size:11px;margin-top:4px;">⚠️ Overlaps with ${_esc(home)} vs ${_esc(away)} on this court</div>`;
  },

  _matchTile(fixture) {
    const home = Courts._teamName(fixture, 'home_team');
    const away = Courts._teamName(fixture, 'away_team');
    const scoreStr = fixture.status === 'completed'
      ? ` (${fixture.home_score}–${fixture.away_score})`
      : '';
    const tileId = `sched-${fixture.id}`;
    return `<div class="court-match-tile">
      <div class="teams">R${fixture.round} · ${_esc(home)} vs ${_esc(away)}${scoreStr}</div>
      ${Courts._courtSelect(fixture)}
      <div style="display:flex;gap:6px;margin-top:6px;">
        <input type="datetime-local" id="${tileId}-time" value="${Courts._toLocalInputValue(fixture.scheduled_start_time)}"
               onchange="Courts.setSchedule('${fixture.id}', this, document.getElementById('${tileId}-dur'))"
               style="flex:1;font-size:11px;">
        <input type="number" id="${tileId}-dur" placeholder="min" value="${fixture.estimated_duration_minutes || ''}"
               onchange="Courts.setSchedule('${fixture.id}', document.getElementById('${tileId}-time'), this)"
               style="width:56px;font-size:11px;">
      </div>
      ${Courts._overlapWarning(fixture)}
    </div>`;
  },

  render() {
    const grid = document.getElementById('courts-grid');
    if (!Courts.fixtures.length) {
      grid.innerHTML = `<div class="empty-state"><span class="empty-icon">🏀</span>No matches yet for this tournament.</div>`;
      return;
    }

    // Scheduled matches first (earliest first), unscheduled ones after —
    // per court, so each column reads as an actual running order.
    const byTime = (a, b) => {
      if (!a.scheduled_start_time && !b.scheduled_start_time) return 0;
      if (!a.scheduled_start_time) return 1;
      if (!b.scheduled_start_time) return -1;
      return new Date(a.scheduled_start_time) - new Date(b.scheduled_start_time);
    };

    const unassigned = Courts.fixtures.filter(f => !f.court).sort(byTime);

    const courtColumn = (court) => {
      const matches = Courts.fixtures.filter(f => f.court === court.id).sort(byTime);
      return `<div class="court-column">
        <h3>
          <span>${_esc(court.court_name)} ${court.is_active ? '' : '<span style="color:var(--text-tertiary);font-weight:400;">(inactive)</span>'}</span>
          <button class="btn sm ghost" onclick="Courts.toggleCourtActive('${court.id}', ${court.is_active})">
            ${court.is_active ? 'Deactivate' : 'Activate'}
          </button>
        </h3>
        ${matches.length ? matches.map(Courts._matchTile).join('') : '<p style="font-size:12px;color:var(--text-tertiary);">No matches assigned</p>'}
      </div>`;
    };

    // Group courts by venue so "Main Gym: Court 1, Court 2" reads together,
    // rather than a flat list of courts with no sense of which building
    // they're in. Courts with no venue (created before this feature, or
    // via the legacy single-court path) render in their own ungrouped row.
    const venueGroups = Courts.venues.map(venue => {
      const venueCourts = Courts.courts.filter(c => c.venue === venue.id);
      if (!venueCourts.length) return '';
      return `<div style="flex-basis:100%;">
        <h4 style="font-size:12px;color:var(--text-tertiary);margin:14px 0 6px;text-transform:uppercase;letter-spacing:0.03em;">${_esc(venue.venue_name)}</h4>
        <div class="courts-grid" style="margin-top:0;">
          ${venueCourts.map(courtColumn).join('')}
        </div>
      </div>`;
    }).join('');

    const venuelessCourts = Courts.courts.filter(c => !c.venue);
    const venuelessHtml = venuelessCourts.length ? `<div style="flex-basis:100%;">
      <h4 style="font-size:12px;color:var(--text-tertiary);margin:14px 0 6px;text-transform:uppercase;letter-spacing:0.03em;">Other courts</h4>
      <div class="courts-grid" style="margin-top:0;">
        ${venuelessCourts.map(courtColumn).join('')}
      </div>
    </div>` : '';

    const unassignedColumn = `<div style="flex-basis:100%;">
      <h4 style="font-size:12px;color:var(--text-tertiary);margin:14px 0 6px;text-transform:uppercase;letter-spacing:0.03em;">Unassigned (${unassigned.length})</h4>
      <div class="courts-grid" style="margin-top:0;">
        <div class="court-column">
          ${unassigned.length ? unassigned.map(Courts._matchTile).join('') : '<p style="font-size:12px;color:var(--text-tertiary);">Everything\'s assigned</p>'}
        </div>
      </div>
    </div>`;

    grid.innerHTML = `<div style="display:flex;flex-wrap:wrap;">${venueGroups}${venuelessHtml}${unassignedColumn}</div>`;
  },

  _renderAuthBar() {
    const ctrl = document.getElementById('auth-controls');
    const navUsers = document.getElementById('nav-users');
    if (navUsers) navUsers.style.display = Auth.isAdmin() ? '' : 'none';
    const navCourts = document.getElementById('nav-courts');
    if (navCourts) navCourts.style.display = Auth.isAdmin() ? '' : 'none';
    if (!ctrl) return;
    const user = Auth.user();
    if (user) {
      ctrl.innerHTML = `
        <span style="font-size:12px;color:var(--text-secondary);">${_esc(user.name || user.email)}</span>
        <button class="btn sm ghost" onclick="Auth.logout()">Sign out</button>`;
    } else {
      ctrl.innerHTML = `<a href="login.html" class="btn sm primary">Sign in</a>`;
    }
  },
};

function _esc(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

const UI = {
  showError(bannerId, msgId, message) {
    document.getElementById(msgId).textContent = message;
    document.getElementById(bannerId).classList.add('visible');
  },
};

// Minimal DB shim — courts.js only needs the court/fixture functions already
// defined in the shared db.js, but db.js isn't loaded on this page (it also
// depends on state.js/generators.js which this page doesn't need). Rather
// than pull in the whole chain, duplicate just the handful of calls used here.
const DB = {
  async getVenues(tournamentId) {
    return pb.collection('venues').getFullList({
      filter: `tournament="${tournamentId}"`, sort: 'venue_name', requestKey: null,
    });
  },
  async createVenue(tournamentId, venueName, courtCount) {
    const venue = await pb.collection('venues').create({
      tournament: tournamentId, venue_name: venueName, court_count: courtCount,
    });
    // Generate the N court records under this venue — matches how the
    // migration comment describes it: individual venues_courts records
    // remain the source of truth fixtures.court points at.
    const creates = [];
    for (let i = 1; i <= courtCount; i++) {
      creates.push(pb.collection('venues_courts').create({
        tournament: tournamentId, venue: venue.id,
        court_name: `Court ${i}`, is_active: true,
      }));
    }
    await Promise.all(creates);
    return venue;
  },
  async getCourts(tournamentId) {
    return pb.collection('venues_courts').getFullList({
      filter: `tournament="${tournamentId}"`, sort: 'venue,court_name', requestKey: null,
    });
  },
  async getFixtures(tournamentId) {
    return pb.collection('fixtures').getFullList({
      filter: `tournament="${tournamentId}"`, sort: 'round,match_number',
      expand: 'home_team.master_team,away_team.master_team,court', requestKey: null,
    });
  },
  async createCourt(tournamentId, courtName) {
    return pb.collection('venues_courts').create({ tournament: tournamentId, court_name: courtName, is_active: true });
  },
  async setCourtActive(courtId, isActive) {
    return pb.collection('venues_courts').update(courtId, { is_active: isActive });
  },
  async assignFixtureCourt(fixtureId, courtId) {
    return pb.collection('fixtures').update(fixtureId, { court: courtId || '' });
  },
  async setFixtureSchedule(fixtureId, startTimeIso, durationMinutes) {
    return pb.collection('fixtures').update(fixtureId, {
      scheduled_start_time: startTimeIso || '',
      estimated_duration_minutes: durationMinutes || null,
    });
  },
};

document.addEventListener('DOMContentLoaded', Courts.init);
