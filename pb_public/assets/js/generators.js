/**
 * =============================================================================
 * generators.js — Fixture generation algorithms (pure functions, no DB calls)
 *
 * Depends on: config.js (escHtml), logger.js
 * =============================================================================
 */

/* =============================================================================
 *  ROUND ROBIN — circle rotation method
 *  Every team plays every other team once.
 *  Odd team counts get a synthetic BYE to keep pairs even.
 *  ============================================================================= */
function genRoundRobin(teams) {
  Logger.debug('genRoundRobin', { count: teams.length });
  const list  = teams.length % 2 === 1 ? [...teams, 'BYE'] : [...teams];
  const total = list.length;
  const rounds = [];

  for (let r = 0; r < total - 1; r++) {
    const matches = [];
    for (let i = 0; i < total / 2; i++) {
      const a = list[i], b = list[total - 1 - i];
      if (a !== 'BYE' && b !== 'BYE') matches.push({ a, b, isBye: false });
    }
    if (matches.length) rounds.push({ label: `Round ${r + 1}`, matches });
    list.splice(1, 0, list.pop());
  }

  const totalMatches = rounds.reduce((s, r) => s + r.matches.length, 0);
  Logger.debug('genRoundRobin done', { rounds: rounds.length, totalMatches });
  return { type: 'round_robin', rounds, totalMatches };
}

/* =============================================================================
 *  SINGLE ELIMINATION — fixed-slot seed tree
 *  Pads to next power of 2. BYE slots auto-advance to round 2 on persist.
 *  ============================================================================= */
function genElimination(teams) {
  Logger.debug('genElimination', { count: teams.length });

  let size = 1;
  while (size < teams.length) size *= 2;
  const byes = size - teams.length;

  const slots       = [...teams, ...Array(byes).fill('BYE')];
  const totalRounds = Math.log2(size);
  const allRounds   = [];

  const round1Matches = [];
  for (let i = 0; i < size; i += 2) {
    const a           = slots[i];
    const b           = slots[i + 1];
    const isBye       = b === 'BYE';
    const matchNumber = Math.floor(i / 2) + 1;

    round1Matches.push({
      a, b, isBye,
      nextRound       : 2,
      nextMatchNumber : Math.ceil(matchNumber / 2),
                       nextSlot        : matchNumber % 2 === 1 ? 'home' : 'away',
    });
  }

  const r1Label = _roundLabel(round1Matches.length, totalRounds, 1);
  allRounds.push({ roundNumber: 1, label: r1Label, matches: round1Matches });

  let matchCount = size / 2;
  for (let r = 2; r <= totalRounds; r++) {
    matchCount = matchCount / 2;
    const matches = [];
    for (let m = 1; m <= matchCount; m++) {
      matches.push({
        a: 'TBD', b: 'TBD', isBye: false,
        nextRound       : r < totalRounds ? r + 1 : null,
        nextMatchNumber : r < totalRounds ? Math.ceil(m / 2) : null,
                   nextSlot        : m % 2 === 1 ? 'home' : 'away',
      });
    }
    allRounds.push({ roundNumber: r, label: _roundLabel(matchCount, totalRounds, r), matches });
  }

  const totalMatches = round1Matches.filter(m => !m.isBye).length +
  allRounds.slice(1).reduce((s, r) => s + r.matches.length, 0);

  Logger.info('genElimination done', {
    size, byes,
    rounds      : allRounds.length,
    totalMatches,
    roundSummary: allRounds.map(r => `${r.label}: ${r.matches.length} matches`),
  });

  return { type: 'elimination', rounds: allRounds, totalMatches };
}

/**
 * Derive display label for a bracket round.
 */
function _roundLabel(matchCount, totalRounds, roundNumber) {
  const fromEnd = totalRounds - roundNumber + 1;
  if (fromEnd === 1) return 'Final';
  if (fromEnd === 2) return 'Semifinals';
  if (fromEnd === 3) return 'Quarterfinals';
  return `Round of ${matchCount * 2}`;
}

/* =============================================================================
 *  GROUP STAGE — snake distribution + round robin per group + elimination KO
 *  Kept for backward compatibility / anywhere still calling the old signature
 *  directly with a flat team-name array and no manual assignment. New admin
 *  flows go through buildManualGroups() + genGroupStageFromGroups() below.
 *  ============================================================================= */
function genGroupStage(teams, teamsPerPool = null) {
  Logger.debug('genGroupStage', { count: teams.length, teamsPerPool });
  const numGroups = teamsPerPool
  ? Math.max(1, Math.ceil(teams.length / teamsPerPool))
  : (teams.length <= 8 ? 2 : teams.length <= 12 ? 3 : 4);
  const groups    = Array.from({ length: numGroups }, () => []);
  teams.forEach((t, i) => groups[i % numGroups].push(t));

  const letters       = 'ABCDEFGH';
  const groupFixtures = groups.map((g, gi) => ({
    name   : `Group ${letters[gi]}`,
    teams  : g,
    rounds : genRoundRobin(g).rounds,
  }));

  const advancers = groups.map(g => g.slice(0, 2)).flat();
  const knockout  = genElimination(advancers);

  const totalGroupMatches = groupFixtures.reduce(
    (s, g) => s + g.rounds.reduce((rs, r) => rs + r.matches.length, 0), 0
  );
  const totalMatches = totalGroupMatches + knockout.totalMatches;

  Logger.debug('genGroupStage done', { totalGroupMatches, knockoutMatches: knockout.totalMatches, totalMatches });
  return { type: 'group_stage', groupFixtures, knockout, totalMatches, numGroups };
}

/**
 * Builds group_stage groups from a team list that may have partial manual
 * group_name assignments (letters 'A','B',...). Teams without a group_name
 * are auto-distributed into whichever pool currently has the FEWEST teams
 * — ties broken by pool letter order (A before B) so results are
 * deterministic given the same input. Teams the admin explicitly placed
 * are never moved from their assigned pool.
 *
 * @param {Array<{name:string, group_name:string|null}>} teams
 * @param {number} poolCount
 * @returns {Array<{name:string, teams:string[]}>}
 */
function buildManualGroups(teams, poolCount) {
  const letters = 'ABCDEFGH'.slice(0, poolCount).split('');
  const groups = {};
  letters.forEach(l => groups[l] = []);

  const unassigned = [];
  teams.forEach(t => {
    if (t.group_name && groups[t.group_name] !== undefined) {
      groups[t.group_name].push(t.name);
    } else {
      unassigned.push(t.name);
    }
  });

  unassigned.forEach(name => {
    let target = letters[0];
    let minCount = groups[target].length;
    for (const l of letters) {
      if (groups[l].length < minCount) { target = l; minCount = groups[l].length; }
    }
    groups[target].push(name);
  });

  Logger.debug('buildManualGroups', {
    poolCount, unassignedCount: unassigned.length,
    sizes: letters.map(l => `${l}:${groups[l].length}`),
  });

  return letters.map(l => ({ name: `Group ${l}`, teams: groups[l] }));
}

/**
 * Same output shape as genGroupStage, but takes pre-built groups instead
 * of computing distribution itself. Used whenever manual pool assignment
 * is in play — which is now always, since buildManualGroups handles the
 * "nobody assigned anything manually" case too by auto-distributing
 * everyone evenly.
 *
 * @param {Array<{name:string, teams:string[]}>} groups
 */
function genGroupStageFromGroups(groups) {
  Logger.debug('genGroupStageFromGroups', { numGroups: groups.length, sizes: groups.map(g => g.teams.length) });

  const groupFixtures = groups.map(g => ({
    name  : g.name,
    teams : g.teams,
    rounds: genRoundRobin(g.teams).rounds,
  }));

  const advancers = groups.map(g => g.teams.slice(0, 2)).flat();
  const knockout  = genElimination(advancers);

  const totalGroupMatches = groupFixtures.reduce(
    (s, g) => s + g.rounds.reduce((rs, r) => rs + r.matches.length, 0), 0
  );
  const totalMatches = totalGroupMatches + knockout.totalMatches;

  return { type: 'group_stage', groupFixtures, knockout, totalMatches, numGroups: groups.length };
}

/* =============================================================================
 *  LIVE GROUP STANDINGS COMPUTATION
 *  Derives team IDs from fixture records directly — robust even if team
 *  records have missing or incorrect group_name values.
 *  ============================================================================= */
function _computeGroupStandings(fixtures, teams, groupName) {
  const allGroupFx = fixtures.filter(f => f.group_name === groupName && !f.is_bye);
  if (!allGroupFx.length) {
    Logger.warn('_computeGroupStandings: no fixtures found', { groupName });
    return [];
  }

  const resolveId = (val) => {
    if (!val) return null;
    if (typeof val === 'object') return val.id ?? null;
    return val;
  };

  const teamIdsInGroup = new Set();
  allGroupFx.forEach(f => {
    const hId = resolveId(f.home_team);
    const aId = resolveId(f.away_team);
    if (hId) teamIdsInGroup.add(hId);
    if (aId) teamIdsInGroup.add(aId);
  });

    const standingsMap = {};
    teamIdsInGroup.forEach(id => {
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

    allGroupFx.filter(f => f.status === 'completed').forEach(f => {
      const home = standingsMap[resolveId(f.home_team)];
      const away = standingsMap[resolveId(f.away_team)];
      if (!home || !away) return;

      home.played++; away.played++;
      home.ptsFor    += (f.home_score || 0); home.ptsAgainst += (f.away_score || 0);
      away.ptsFor    += (f.away_score || 0); away.ptsAgainst += (f.home_score || 0);

      if ((f.home_score || 0) > (f.away_score || 0)) { home.wins++; away.losses++; }
      else                                             { away.wins++; home.losses++; }
    });

    return Object.values(standingsMap).sort((a, b) => {
      if (b.wins !== a.wins)           return b.wins - a.wins;
      if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
      return b.ptsFor - a.ptsFor;
    });
}
