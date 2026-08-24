/**
 * =============================================================================
 * db.js — Database layer + Migration functions
 *
 * Depends on: config.js, logger.js, auth.js, state.js, generators.js
 *
 * CHANGES
 * -------
 * - master_teams is pure identity now (name + optional club/short-name/
 *   home-court) — no gender or age_group. A team's category is determined
 *   entirely by which tournament its teams-link points at, since every
 *   tournament already IS one category.
 * - findMasterTeam/createMasterTeam/getOrCreateMasterTeam match on name only.
 * - All filter strings use no spaces around operators (PocketBase strict mode).
 * - requestKey: null on all getFullList calls to prevent auto-cancellation.
 * - Phase 2: added getUpcomingGames() for the public homepage's Upcoming
 *   Games section — real scheduled fixtures across all tournaments only,
 *   never synthesized.
 * =============================================================================
 */

const DB = {

  /* ── HEALTH ─────────────────────────────────────────────────────────── */

  async healthCheck() {
    try {
      await pb.health.check();
      Logger.info('PocketBase health OK');
      return true;
    } catch (e) {
      Logger.error('PocketBase health failed', { error: e.message });
      return false;
    }
  },

  /* ── TOURNAMENTS ─────────────────────────────────────────────────────── */

  async getTournaments() {
    return pb.collection('tournaments').getFullList({
      sort      : '-created',
      requestKey: null,
    });
  },

  // One query for every tournament's registered-team count, rather than one
  // query per card — used for the home screen's slot-counter progress bar.
  async getAllTeamCounts() {
    const rows = await pb.collection('teams').getFullList({
      fields    : 'id,tournament',
      requestKey: null,
    });
    const counts = {};
    rows.forEach(r => { counts[r.tournament] = (counts[r.tournament] || 0) + 1; });
    return counts;
  },

  async getEvents() {
    try {
      const all   = await pb.collection('tournaments').getFullList({
        fields    : 'event_name',
        requestKey: null,
      });
      const names = [...new Set(all.map(t => t.event_name).filter(Boolean))].sort();
      Logger.debug('DB.getEvents', { count: names.length });
      return names;
    } catch (e) {
      Logger.warn('DB.getEvents failed', { error: e.message });
      return [];
    }
  },

  // Real scheduled fixtures across ALL tournaments, soonest first — powers
  // the public homepage's "Upcoming games" section. Deliberately requires
  // scheduled_start_time to be set: falling back to round/match order for
  // fixtures with no real time would present "unscheduled" as "upcoming",
  // which is a fabrication, not a display choice. If no tournament has set
  // real times yet, this returns an empty list and the section stays
  // hidden — no placeholder games.
  async getUpcomingGames(limit = 6) {
    try {
      const result = await pb.collection('fixtures').getList(1, limit, {
        filter    : `status="scheduled" && is_bye=false && home_team!="" && away_team!="" && scheduled_start_time!=""`,
        sort      : '+scheduled_start_time',
        expand    : 'home_team,away_team,tournament',
        requestKey: null,
      });
      Logger.debug('DB.getUpcomingGames', { count: result.items.length });
      return result.items;
    } catch (e) {
      Logger.warn('DB.getUpcomingGames failed', { error: e.message });
      return [];
    }
  },

  async createTournament(name, format, eventName = null, eventSeries = null, eventEdition = null, registrationDeadline = null, gender = null, ageGroup = null, maxTeams = null) {
    Logger.info('DB.createTournament', { name, format, eventName, eventSeries, eventEdition, registrationDeadline, gender, ageGroup, maxTeams });
    return pb.collection('tournaments').create({
      name,
      format,
        status        : 'pending',
        event_name    : eventName    || null,
        event_series  : eventSeries  || null,
        event_edition : eventEdition || null,
        registration_deadline: registrationDeadline || null,
        gender        : gender   || null,
        age_group     : ageGroup || null,
        max_teams     : maxTeams || null,
    });
  },

  async uploadTournamentBanner(tournamentId, file) {
    const formData = new FormData();
    formData.append('banner_image', file);
    Logger.info('DB.uploadTournamentBanner', { tournamentId, fileName: file.name });
    return pb.collection('tournaments').update(tournamentId, formData);
  },

  async updateTournament(id, data) {
    return pb.collection('tournaments').update(id, data);
  },

  async deleteTournament(id) {
    Logger.warn('DB.deleteTournament', { id });
    return pb.collection('tournaments').delete(id);
  },

  /* ── MASTER TEAMS (databank) ─────────────────────────────────────────── */

  /**
   * Fetch all master teams, sorted by name.
   * Optionally filter by gender and/or age_group.
   */
  // No filter args anymore — master_teams is pure identity now (name only,
  // plus optional club/short-name/home-court). A team's category is
  // determined entirely by which tournament its teams-link points at,
  // never by anything stored on the master record.
  async getMasterTeams() {
    return pb.collection('master_teams').getFullList({
      sort      : 'name',
      requestKey: null,
    });
  },

  // Find a master team by name only — name IS the identity now. Two
  // genuinely different squads sharing a club name are expected to be
  // registered as two distinctly-named records (e.g. "Shauri Moyo A" /
  // "Shauri Moyo B"), not disambiguated by category.
  async findMasterTeam(name) {
    try {
      const results = await pb.collection('master_teams').getFullList({
        filter    : `name="${name}"`,
        requestKey: null,
      });
      return results[0] ?? null;
    } catch (e) {
      Logger.warn('DB.findMasterTeam failed', { name, error: e.message });
      return null;
    }
  },

  /**
   * Create a new master team record.
   */
  async createMasterTeam(name, shortName = null, homeCourt = null, clubName = null) {
    Logger.info('DB.createMasterTeam', { name, clubName });
    return pb.collection('master_teams').create({
      name,
      short_name : shortName || null,
      home_court : homeCourt || null,
      club_name  : clubName  || null,
      active     : true,
    });
  },

  /**
   * Update an existing master team record.
   */
  async updateMasterTeam(id, data) {
    Logger.info('DB.updateMasterTeam', { id });
    return pb.collection('master_teams').update(id, data);
  },

  /**
   * Delete a master team record.
   */
  async deleteMasterTeam(id) {
    Logger.warn('DB.deleteMasterTeam', { id });
    return pb.collection('master_teams').delete(id);
  },

  /**
   * Get or create a master team by name + gender + age_group.
   *
   * Called during tournament setup so returning teams are linked automatically.
   * If the team name matches an existing record with the same gender + age_group,
   * the existing record is reused. Otherwise a new one is created.
   *
   * @param {string}      name
   * @param {string|null} gender    - "Boys" | "Girls" | "Mixed"
   * @param {string|null} ageGroup  - e.g. "U16", "U13", "Senior"
   * @returns {string} master_team record ID
   */
  async getOrCreateMasterTeam(name) {
    const existing = await DB.findMasterTeam(name);
    if (existing) {
      Logger.debug('DB.getOrCreateMasterTeam: found', { name, id: existing.id });
      return existing.id;
    }
    const created = await DB.createMasterTeam(name);
    Logger.info('DB.getOrCreateMasterTeam: created', { name, id: created.id });
    return created.id;
  },

  /* ── TOURNAMENT TEAMS ────────────────────────────────────────────────── */

  async createTeam(tournamentId, name, seed, groupName, masterTeamId = null) {
    return pb.collection('teams').create({
      tournament  : tournamentId,
      name,
      seed        : seed        ?? null,
      group_name  : groupName   ?? null,
      master_team : masterTeamId ?? null,
    });
  },

  async getTeams(tournamentId) {
    return pb.collection('teams').getFullList({
      filter    : `tournament="${tournamentId}"`,
      sort      : 'seed',
      expand    : 'master_team',
      requestKey: null,
    });
  },

  /* ── FIXTURES ────────────────────────────────────────────────────────── */

  async createFixture(data) {
    return pb.collection('fixtures').create(data);
  },

  async getFixtures(tournamentId) {
    return pb.collection('fixtures').getFullList({
      filter    : `tournament="${tournamentId}"`,
      sort      : 'round,match_number',
      expand    : 'home_team,away_team,winner,court',
      requestKey: null,
    });
  },

  async deleteFixturesForTournament(tournamentId) {
    const fixtures = await pb.collection('fixtures').getFullList({
      filter: `tournament="${tournamentId}"`, fields: 'id', requestKey: null,
    });
    await Promise.all(fixtures.map(f => pb.collection('fixtures').delete(f.id)));
    Logger.warn('deleteFixturesForTournament', { tournamentId, count: fixtures.length });
  },

  /* ── COURTS ──────────────────────────────────────────────────────────── */

  async getCourts(tournamentId) {
    return pb.collection('venues_courts').getFullList({
      filter    : `tournament="${tournamentId}"`,
      sort      : 'court_name',
      requestKey: null,
    });
  },

  async createCourt(tournamentId, courtName) {
    return pb.collection('venues_courts').create({
      tournament : tournamentId,
      court_name : courtName,
      is_active  : true,
    });
  },

  async setCourtActive(courtId, isActive) {
    return pb.collection('venues_courts').update(courtId, { is_active: isActive });
  },

  async assignFixtureCourt(fixtureId, courtId) {
    return pb.collection('fixtures').update(fixtureId, { court: courtId || '' });
  },

  async saveFixtureResult(fixtureId, homeScore, awayScore, winnerId, scheduledTime = null, courtId = null) {
    Logger.info('DB.saveFixtureResult', { fixtureId, homeScore, awayScore, winnerId, scheduledTime, courtId });
    return pb.collection('fixtures').update(fixtureId, {
      home_score      : homeScore,
      away_score      : awayScore,
      winner          : winnerId,
      status          : 'completed',
      scheduled_time  : scheduledTime || '',
      court           : courtId || '',
    });
  },

  /* ── TEAM STATS ──────────────────────────────────────────────────────── */

  async saveTeamStats(tournamentId, fixtures, teams) {
    Logger.info('DB.saveTeamStats', { tournamentId });

    const realFx = fixtures.filter(f => !f.is_bye && f.status === 'completed');

    const statsMap = {};
    teams.forEach(t => {
      if (!t.master_team) return;
      const masterId = typeof t.master_team === 'object' ? t.master_team.id : t.master_team;
      statsMap[t.id] = {
        teamId        : t.id,
        masterId,
        wins          : 0,
        losses        : 0,
        points_for    : 0,
        points_against: 0,
        group_name    : t.group_name || null,
      };
    });

    realFx.forEach(f => {
      const resolveId = v => typeof v === 'object' ? v?.id : v;
      const homeId    = resolveId(f.home_team);
      const awayId    = resolveId(f.away_team);
      const home      = statsMap[homeId];
      const away      = statsMap[awayId];

      if (home) {
        home.points_for     += (f.home_score || 0);
        home.points_against += (f.away_score || 0);
        if ((f.home_score || 0) > (f.away_score || 0)) home.wins++;
        else home.losses++;
      }
      if (away) {
        away.points_for     += (f.away_score || 0);
        away.points_against += (f.home_score || 0);
        if ((f.away_score || 0) > (f.home_score || 0)) away.wins++;
        else away.losses++;
      }
    });

    const placements = DB._computePlacements(fixtures);

    for (const stat of Object.values(statsMap)) {
      if (!stat.masterId) continue;
      try {
        const existing = await pb.collection('team_stats').getFullList({
          filter    : `master_team="${stat.masterId}"&&tournament="${tournamentId}"`,
          requestKey: null,
        });

        const data = {
          master_team    : stat.masterId,
          tournament     : tournamentId,
          wins           : stat.wins,
          losses         : stat.losses,
          points_for     : stat.points_for,
          points_against : stat.points_against,
          placement      : placements[stat.teamId] ?? null,
          group_name     : stat.group_name,
        };

        if (existing.length) {
          await pb.collection('team_stats').update(existing[0].id, data);
        } else {
          await pb.collection('team_stats').create(data);
        }
        Logger.debug('DB.saveTeamStats: saved', { masterId: stat.masterId });
      } catch (e) {
        Logger.warn('DB.saveTeamStats: failed', { masterId: stat.masterId, error: e.message });
      }
    }

    Logger.info('DB.saveTeamStats: complete', { count: Object.keys(statsMap).length });
  },

  _computePlacements(fixtures) {
    const placements = {};
    const resolveId  = v => typeof v === 'object' ? v?.id : v;

    const finalFx = fixtures.find(f =>
    f.round_label === 'Final' && f.status === 'completed'
    );
    if (finalFx) {
      const winnerId = resolveId(finalFx.winner);
      const homeId   = resolveId(finalFx.home_team);
      const awayId   = resolveId(finalFx.away_team);
      const loserId  = winnerId === homeId ? awayId : homeId;
      if (winnerId) placements[winnerId] = 1;
      if (loserId)  placements[loserId]  = 2;
    }

    let p = 3;
    fixtures
    .filter(f => f.round_label === 'Semifinals' && f.status === 'completed')
    .forEach(f => {
      const winnerId = resolveId(f.winner);
      const homeId   = resolveId(f.home_team);
      const awayId   = resolveId(f.away_team);
      const loserId  = winnerId === homeId ? awayId : homeId;
      if (loserId && !placements[loserId]) placements[loserId] = p++;
    });

      return placements;
  },

  async getMasterTeamStats(masterTeamId) {
    return pb.collection('team_stats').getFullList({
      filter    : `master_team="${masterTeamId}"`,
      sort      : '-created',
      expand    : 'tournament',
      requestKey: null,
    });
  },

  /* ── FAVOURITES ──────────────────────────────────────────────────────── */

  async getFavourites() {
    if (!Auth.canFavourite()) return [];
    try {
      return await pb.collection('favourites').getFullList({
        filter    : `user="${Auth.user().id}"`,
                                                           expand    : 'tournament',
                                                           requestKey: null,
      });
    } catch (e) {
      Logger.warn('getFavourites failed', { error: e.message });
      return [];
    }
  },

  async addFavourite(tournamentId) {
    return pb.collection('favourites').create({
      user      : Auth.user().id,
                                              tournament: tournamentId,
    });
  },

  async removeFavourite(favouriteId) {
    return pb.collection('favourites').delete(favouriteId);
  },

  /* ── BRACKET ADVANCEMENT ─────────────────────────────────────────────── */

  async advanceWinnerElimination(tournamentId, currentRound, currentMatchNumber, winnerTeamId) {
    const nextRound       = currentRound + 1;
    const nextMatchNumber = Math.ceil(currentMatchNumber / 2);
    const slot            = currentMatchNumber % 2 === 1 ? 'home_team' : 'away_team';

    Logger.info('DB.advanceWinner', {
      from: `R${currentRound}M${currentMatchNumber}`,
      to  : `R${nextRound}M${nextMatchNumber}`, slot,
    });

    try {
      const nextFx = await pb.collection('fixtures').getFullList({
        filter    : `tournament="${tournamentId}"&&round=${nextRound}&&match_number=${nextMatchNumber}`,
        requestKey: null,
      });
      if (!nextFx.length) { Logger.warn('advanceWinner: no next fixture'); return; }
      await pb.collection('fixtures').update(nextFx[0].id, { [slot]: winnerTeamId });
      Logger.info('Winner placed', { nextFixtureId: nextFx[0].id, slot });
    } catch (e) {
      Logger.warn('advanceWinner failed', { error: e.message });
    }
  },

  // Dry-run only — walks forward from (round, matchNumber) through the
  // bracket, collecting every downstream match that's ALREADY been played
  // and would need to be reset if this match's winner changes. Mutates
  // nothing. Used to show a confirmation before cascadeReseed actually runs.
  async getBracketImpact(tournamentId, round, matchNumber) {
    const affected = [];
    let r = round, m = matchNumber;
    while (true) {
      const nextRound = r + 1;
      const nextMatch  = Math.ceil(m / 2);
      const nextFx = await pb.collection('fixtures').getFullList({
        filter    : `tournament="${tournamentId}"&&round=${nextRound}&&match_number=${nextMatch}&&is_bye=false`,
        expand    : 'home_team,away_team',
        requestKey: null,
      });
      if (!nextFx.length) break; // reached the final, or no such round exists
      const fx = nextFx[0];
      if (fx.status !== 'completed') break; // not played yet — nothing further is at risk
      affected.push(fx);
      r = nextRound; m = nextMatch; // this match's own winner may have advanced further still
    }
    return affected;
  },

  // The real re-seed: places the corrected winner in the next slot, and —
  // critically — if that next match had ALREADY been played, resets it
  // (and keeps walking forward to reset anything further down the chain
  // too), rather than the old behavior of blindly overwriting a played
  // match's data with no warning.
  async cascadeReseed(tournamentId, round, matchNumber, newWinnerId) {
    const resetFixtures = [];
    let r = round, m = matchNumber;
    let incomingTeamId = newWinnerId;

    while (true) {
      const nextRound = r + 1;
      const nextMatch  = Math.ceil(m / 2);
      const slot       = m % 2 === 1 ? 'home_team' : 'away_team';

      const nextFx = await pb.collection('fixtures').getFullList({
        filter    : `tournament="${tournamentId}"&&round=${nextRound}&&match_number=${nextMatch}&&is_bye=false`,
        requestKey: null,
      });
      if (!nextFx.length) break;
      const fx = nextFx[0];
      const wasCompleted = fx.status === 'completed';

      const updateData = { [slot]: incomingTeamId || '' };
      if (wasCompleted) {
        updateData.status     = 'scheduled';
        updateData.winner     = '';
        updateData.home_score = null;
        updateData.away_score = null;
        resetFixtures.push({ id: fx.id, round: nextRound, matchNumber: nextMatch });
      }
      await pb.collection('fixtures').update(fx.id, updateData);

      if (!wasCompleted) break; // clean placement into an unplayed match — nothing further to unwind
      // fx's own (now-invalidated) winner may have advanced even further —
      // keep walking to find and reset it too. Nothing valid to place at
      // the next slot since fx itself just went back to "not yet decided."
      r = nextRound; m = nextMatch;
      incomingTeamId = null;
    }
    return resetFixtures;
  },

  async clearAdvancedWinner(tournamentId, currentRound, currentMatchNumber) {
    const nextRound       = currentRound + 1;
    const nextMatchNumber = Math.ceil(currentMatchNumber / 2);
    const slot            = currentMatchNumber % 2 === 1 ? 'home_team' : 'away_team';

    try {
      const nextFx = await pb.collection('fixtures').getFullList({
        filter    : `tournament="${tournamentId}"&&round=${nextRound}&&match_number=${nextMatchNumber}`,
        requestKey: null,
      });
      if (!nextFx.length) return;
      await pb.collection('fixtures').update(nextFx[0].id, {
        [slot]: null, status: 'scheduled',
        winner: null, home_score: null, away_score: null,
      });
    } catch (e) {
      Logger.warn('clearAdvancedWinner failed', { error: e.message });
    }
  },

  async repairNextFixture(tournamentId, currentRound, currentMatchNumber, winnerTeamId) {
    const nextRound       = currentRound + 1;
    const nextMatchNumber = Math.ceil(currentMatchNumber / 2);
    const slot            = currentMatchNumber % 2 === 1 ? 'home_team' : 'away_team';

    try {
      const expected = await pb.collection('fixtures').getFullList({
        filter    : `tournament="${tournamentId}"&&round=${nextRound}&&match_number=${nextMatchNumber}&&is_bye=false`,
        requestKey: null,
      });

      if (expected.length) {
        const fx      = expected[0];
        const current = typeof fx[slot] === 'object' ? fx[slot]?.id : fx[slot];
        if (current === winnerTeamId) return;
        await pb.collection('fixtures').update(fx.id, { [slot]: winnerTeamId });
        Logger.warn('repairNextFixture: corrected slot', { fixtureId: fx.id, slot });
        return;
      }

      // Fallback scan for old buggy round numbers
      const allKnockout = await pb.collection('fixtures').getFullList({
        filter    : `tournament="${tournamentId}"&&group_name=""&&is_bye=false`,
        sort      : 'round,match_number',
        requestKey: null,
      });

      const rounds          = [...new Set(allKnockout.map(f => f.round))].sort((a, b) => a - b);
      const currentRoundIdx = rounds.indexOf(currentRound);
      if (currentRoundIdx === -1 || currentRoundIdx + 1 >= rounds.length) return;

      const actualNextRound  = rounds[currentRoundIdx + 1];
      const nextRoundFx      = allKnockout.filter(f => f.round === actualNextRound).sort((a, b) => a.match_number - b.match_number);
      const currentRoundFx   = allKnockout.filter(f => f.round === currentRound).sort((a, b) => a.match_number - b.match_number);
      const positionInRound  = currentRoundFx.findIndex(f => f.match_number === currentMatchNumber);
      const targetFixtureIdx = Math.floor(positionInRound / 2);
      const targetSlot       = positionInRound % 2 === 0 ? 'home_team' : 'away_team';

      if (targetFixtureIdx >= nextRoundFx.length) return;

      const targetFx   = nextRoundFx[targetFixtureIdx];
      const currentVal = typeof targetFx[targetSlot] === 'object'
      ? targetFx[targetSlot]?.id : targetFx[targetSlot];
      if (currentVal === winnerTeamId) return;

      await pb.collection('fixtures').update(targetFx.id, { [targetSlot]: winnerTeamId });
      Logger.warn('repairNextFixture: patched via scan', { fixtureId: targetFx.id });

    } catch (e) {
      Logger.warn('repairNextFixture failed', { error: e.message });
    }
  },

  async seedKnockoutFromGroups(tournamentId, allTeams) {
    Logger.info('DB.seedKnockoutFromGroups: checking group completion');

    const freshFixtures = await pb.collection('fixtures').getFullList({
      filter    : `tournament="${tournamentId}"`,
      sort      : 'round,match_number',
      expand    : 'home_team,away_team,winner',
      requestKey: null,
    });

    const groupFxAll = freshFixtures.filter(f => f.group_name && !f.is_bye);
    if (!groupFxAll.length) return false;
    if (!groupFxAll.every(f => f.status === 'completed')) return false;

    Logger.info('seedKnockoutFromGroups: seeding knockout');

    const groupNames    = [...new Set(groupFxAll.map(f => f.group_name))].sort();
    const groupRankings = groupNames.map(gName => {
      const top2 = _computeGroupStandings(freshFixtures, allTeams, gName).slice(0, 2);
      Logger.info(`${gName} top 2`, top2.map(s => `${s.name} W:${s.wins}`));
      return top2;
    });

    const firsts  = groupRankings.map(g => g[0]);
    const seconds = groupRankings.map(g => g[1]);
    const advancers = [];
    for (let i = 0; i < firsts.length; i++) {
      advancers.push(firsts[i]);
      advancers.push(seconds[(i + 1) % seconds.length]);
    }

    if (advancers.some(a => !a?.teamId)) {
      Logger.error('seedKnockoutFromGroups: missing teamId — aborting');
      return false;
    }

    const knockoutFx = freshFixtures
    .filter(f => !f.group_name && !f.is_bye)
    .sort((a, b) => a.round !== b.round ? a.round - b.round : a.match_number - b.match_number);

    if (!knockoutFx.length) return false;

    const firstKoRound = Math.min(...knockoutFx.map(f => f.round));
    const firstRoundFx = knockoutFx
    .filter(f => f.round === firstKoRound)
    .sort((a, b) => a.match_number - b.match_number);

    for (let i = 0; i < firstRoundFx.length; i++) {
      await pb.collection('fixtures').update(firstRoundFx[i].id, {
        home_team: advancers[i * 2].teamId,
        away_team: advancers[i * 2 + 1].teamId,
      });
    }

    return true;
  },

};  // ← end of DB object

/* =============================================================================
 *  MIGRATION — standalone async functions
 *  ============================================================================= */
async function migrateExistingTournaments() {
  Logger.info('Migration: checking for broken tournaments');
  let tournaments;
  try {
    tournaments = await pb.collection('tournaments').getFullList({
      sort: '-created', requestKey: null,
    });
  } catch (e) {
    Logger.error('Migration: failed to fetch', { error: e.message });
    return;
  }

  const active = tournaments.filter(t => t.status === 'active' && t.format === 'group_stage');
  for (const tournament of active) {
    try { await _migrateTournament(tournament); }
    catch (e) { Logger.error('Migration failed', { id: tournament.id, error: e.message }); }
  }
  Logger.info('Migration: complete');
}

async function _migrateTournament(tournament) {
  const [allTeams, allFixtures] = await Promise.all([
    pb.collection('teams').getFullList({
      filter: `tournament="${tournament.id}"`, sort: 'seed', requestKey: null,
    }),
    pb.collection('fixtures').getFullList({
      filter: `tournament="${tournament.id}"`,
      sort  : 'round,match_number',
      expand: 'home_team,away_team,winner',
      requestKey: null,
    }),
  ]);

  const groupFx    = allFixtures.filter(f => f.group_name && !f.is_bye);
  const knockoutFx = allFixtures.filter(f => !f.group_name && !f.is_bye);
  if (!groupFx.length || !knockoutFx.length) return;
  if (!groupFx.every(f => f.status === 'completed')) return;

  const firstKoRound    = Math.min(...knockoutFx.map(f => f.round));
  const knockoutUnseeded = knockoutFx
  .filter(f => f.round === firstKoRound)
  .every(f => !f.home_team && !f.away_team);

  if (knockoutUnseeded) {
    await _migrateSeeding(tournament.id, allTeams, allFixtures, knockoutFx);
    return;
  }

  const rounds    = [...new Set(knockoutFx.map(f => f.round))].sort((a, b) => a - b);
  const completed = knockoutFx
  .filter(f => f.status === 'completed' && f.winner)
  .sort((a, b) => a.round - b.round || a.match_number - b.match_number);

  for (const fx of completed) {
    const idx = rounds.indexOf(fx.round);
    if (idx === -1 || idx + 1 >= rounds.length) continue;

    const nextRound      = rounds[idx + 1];
    const currentRoundFx = knockoutFx
    .filter(f => f.round === fx.round)
    .sort((a, b) => a.match_number - b.match_number);
    const posInRound  = currentRoundFx.findIndex(f => f.id === fx.id);
    const slot        = posInRound % 2 === 0 ? 'home_team' : 'away_team';
    const nextRoundFx = knockoutFx
    .filter(f => f.round === nextRound)
    .sort((a, b) => a.match_number - b.match_number);
    const nextFx = nextRoundFx[Math.floor(posInRound / 2)];
    if (!nextFx) continue;

    const winnerId   = typeof fx.winner === 'object' ? fx.winner.id : fx.winner;
    const currentVal = typeof nextFx[slot] === 'object' ? nextFx[slot]?.id : nextFx[slot];
    if (currentVal === winnerId) continue;

    await pb.collection('fixtures').update(nextFx.id, { [slot]: winnerId });
    Logger.warn('Migration: fixed winner slot', { from: `R${fx.round}M${fx.match_number}`, slot });
  }
}

async function _migrateSeeding(tournamentId, allTeams, allFixtures, knockoutFx) {
  const groupNames    = [...new Set(
    allFixtures.filter(f => f.group_name && !f.is_bye).map(f => f.group_name)
  )].sort();
  const groupRankings = groupNames.map(gName =>
  _computeGroupStandings(allFixtures, allTeams, gName).slice(0, 2)
  );
  const firsts  = groupRankings.map(g => g[0]);
  const seconds = groupRankings.map(g => g[1]);
  const advancers = [];
  for (let i = 0; i < firsts.length; i++) {
    advancers.push(firsts[i]);
    advancers.push(seconds[(i + 1) % seconds.length]);
  }
  if (advancers.some(a => !a?.teamId)) { Logger.error('Migration: missing teamId'); return; }

  const firstKoRound = Math.min(...knockoutFx.map(f => f.round));
  const firstRoundFx = knockoutFx
  .filter(f => f.round === firstKoRound)
  .sort((a, b) => a.match_number - b.match_number);

  for (let i = 0; i < firstRoundFx.length; i++) {
    await pb.collection('fixtures').update(firstRoundFx[i].id, {
      home_team: advancers[i * 2].teamId,
      away_team: advancers[i * 2 + 1].teamId,
    });
  }
}
/**
 * migrateHistoricalStats()
 *
 * Backfills master_team links and team_stats for tournaments created before
 * the gender/age_group system was in place. Safe to run on every boot —
 * skips anything already correct.
 *
 * Handles:
 *  - Teams with master_team = null  → creates/links a master record
 *  - Completed tournaments with no team_stats rows → writes them now
 */
async function migrateHistoricalStats() {
  Logger.info('migrateHistoricalStats: starting');

  let tournaments;
  try {
    tournaments = await pb.collection('tournaments').getFullList({
      sort: 'created', requestKey: null,
    });
  } catch (e) {
    Logger.error('migrateHistoricalStats: failed to fetch tournaments', { error: e.message });
    return;
  }

  for (const t of tournaments) {
    try {
      await _migrateOneTournamentStats(t);
    } catch (e) {
      Logger.warn('migrateHistoricalStats: skipped', { name: t.name, error: e.message });
    }
  }

  Logger.info('migrateHistoricalStats: done');
}

async function _migrateOneTournamentStats(tournament) {
  const teams = await pb.collection('teams').getFullList({
    filter    : `tournament="${tournament.id}"`,
    sort      : 'seed',
    expand    : 'master_team',
    requestKey: null,
  });

  // Old records have no gender/age_group — they get null for both,
  // which groups them under "Uncategorised" in stats rather than
  // mixing them into a real age/gender category.
  for (const team of teams) {
    if (team.master_team) continue;

    const masterId = await DB.getOrCreateMasterTeam(team.name);
    await pb.collection('teams').update(team.id, { master_team: masterId });
    Logger.info('migrateHistoricalStats: linked team', {
      tournament: tournament.name,
      team      : team.name,
      masterId,
    });
  }

  // Step 2 — if completed but no team_stats rows exist, write them now.
  if (tournament.status !== 'completed') return;

  const existingStats = await pb.collection('team_stats').getFullList({
    filter    : `tournament="${tournament.id}"`,
    requestKey: null,
  });
  if (existingStats.length > 0) return;

  Logger.info('migrateHistoricalStats: backfilling stats', { name: tournament.name });

  // Re-fetch teams so the master_team links we just wrote are included
  const updatedTeams = await pb.collection('teams').getFullList({
    filter    : `tournament="${tournament.id}"`,
    sort      : 'seed',
    expand    : 'master_team',
    requestKey: null,
  });

  const fixtures = await pb.collection('fixtures').getFullList({
    filter    : `tournament="${tournament.id}"`,
    sort      : 'round,match_number',
    expand    : 'home_team,away_team,winner',
    requestKey: null,
  });

  await DB.saveTeamStats(tournament.id, fixtures, updatedTeams);
}
