/**
 * =============================================================================
 * scores.js — Standalone Quick Score Entry for score_inputter / admin.
 *
 * Deliberately self-contained (own pb client, own DB shim) — same pattern
 * as courts.js/teams.js. Does NOT load app.js/db.js/state.js, so a scorer
 * never pulls in the setup/roster/admin-authoring code path just to enter
 * a result. This is the direct fix for scorers having no independent entry
 * point: previously the only score modal lived inside index.html's
 * screen-fixtures hub, reachable only via App.openTournament().
 *
 * Depends on: config.js (escHtml), shell.js (Shell), generators.js
 * (_computeGroupStandings, for knockout seeding after group stage).
 * =============================================================================
 */

const pb = new PocketBase(CONFIG.API_BASE_URL);

const _Auth = {
    user()   { return pb.authStore.isValid ? pb.authStore.model : null; },
    role()   { return _Auth.user()?.role ?? null; },
    canScore() {
        const r = _Auth.role();
        return r === 'super_admin' || r === 'tournament_admin' || r === 'score_inputter';
    },
};

// Minimal local DB shim — mirrors the exact logic in db.js/app.js's
// _commitResult so behavior (cascade reseed, group→knockout seeding, team
// stats on completion) stays identical, without pulling in db.js's full
// dependency chain (State/generators/Auth/Logger tied to the admin app).
const ScoreDB = {
    async saveFixtureResult(fixtureId, homeScore, awayScore, winnerId) {
        return pb.collection('fixtures').update(fixtureId, {
            home_score: homeScore, away_score: awayScore, winner: winnerId, status: 'completed',
        });
    },

    async getBracketImpact(tournamentId, round, matchNumber) {
        const affected = [];
        let r = round, m = matchNumber;
        while (true) {
            const nextRound = r + 1, nextMatch = Math.ceil(m / 2);
            const nextFx = await pb.collection('fixtures').getFullList({
                filter: `tournament="${tournamentId}"&&round=${nextRound}&&match_number=${nextMatch}&&is_bye=false`,
                requestKey: null,
            });
            if (!nextFx.length) break;
            const fx = nextFx[0];
            if (fx.status !== 'completed') break;
            affected.push(fx);
            r = nextRound; m = nextMatch;
        }
        return affected;
    },

    async cascadeReseed(tournamentId, round, matchNumber, newWinnerId) {
        const resetFixtures = [];
        let r = round, m = matchNumber, incomingTeamId = newWinnerId;
        while (true) {
            const nextRound = r + 1, nextMatch = Math.ceil(m / 2);
            const slot = m % 2 === 1 ? 'home_team' : 'away_team';
            const nextFx = await pb.collection('fixtures').getFullList({
                filter: `tournament="${tournamentId}"&&round=${nextRound}&&match_number=${nextMatch}&&is_bye=false`,
                requestKey: null,
            });
            if (!nextFx.length) break;
            const fx = nextFx[0];
            const wasCompleted = fx.status === 'completed';
            const updateData = { [slot]: incomingTeamId || '' };
            if (wasCompleted) {
                updateData.status = 'scheduled'; updateData.winner = '';
                updateData.home_score = null; updateData.away_score = null;
                resetFixtures.push({ id: fx.id, round: nextRound, matchNumber: nextMatch });
            }
            await pb.collection('fixtures').update(fx.id, updateData);
            if (!wasCompleted) break;
            r = nextRound; m = nextMatch; incomingTeamId = null;
        }
        return resetFixtures;
    },

    async seedKnockoutFromGroups(tournamentId, allTeams) {
        const fresh = await pb.collection('fixtures').getFullList({
            filter: `tournament="${tournamentId}"`, sort: 'round,match_number',
            expand: 'home_team,away_team,winner', requestKey: null,
        });
        const groupFxAll = fresh.filter(f => f.group_name && !f.is_bye);
        if (!groupFxAll.length || !groupFxAll.every(f => f.status === 'completed')) return false;

        const groupNames = [...new Set(groupFxAll.map(f => f.group_name))].sort();
        const groupRankings = groupNames.map(g => _computeGroupStandings(fresh, allTeams, g).slice(0, 2));
        const firsts = groupRankings.map(g => g[0]), seconds = groupRankings.map(g => g[1]);
        const advancers = [];
        for (let i = 0; i < firsts.length; i++) {
            advancers.push(firsts[i]);
            advancers.push(seconds[(i + 1) % seconds.length]);
        }
        if (advancers.some(a => !a?.teamId)) return false;

        const knockoutFx = fresh.filter(f => !f.group_name && !f.is_bye)
        .sort((a, b) => a.round !== b.round ? a.round - b.round : a.match_number - b.match_number);
        if (!knockoutFx.length) return false;

        const firstKoRound = Math.min(...knockoutFx.map(f => f.round));
        const firstRoundFx = knockoutFx.filter(f => f.round === firstKoRound).sort((a, b) => a.match_number - b.match_number);
        for (let i = 0; i < firstRoundFx.length; i++) {
            await pb.collection('fixtures').update(firstRoundFx[i].id, {
                home_team: advancers[i * 2].teamId, away_team: advancers[i * 2 + 1].teamId,
            });
        }
        return true;
    },

    _computePlacements(fixtures) {
        const placements = {};
        const resolveId = v => typeof v === 'object' ? v?.id : v;
        const finalFx = fixtures.find(f => f.round_label === 'Final' && f.status === 'completed');
        if (finalFx) {
            const winnerId = resolveId(finalFx.winner), homeId = resolveId(finalFx.home_team), awayId = resolveId(finalFx.away_team);
            const loserId = winnerId === homeId ? awayId : homeId;
            if (winnerId) placements[winnerId] = 1;
            if (loserId) placements[loserId] = 2;
        }
        let p = 3;
        fixtures.filter(f => f.round_label === 'Semifinals' && f.status === 'completed').forEach(f => {
            const winnerId = resolveId(f.winner), homeId = resolveId(f.home_team), awayId = resolveId(f.away_team);
            const loserId = winnerId === homeId ? awayId : homeId;
            if (loserId && !placements[loserId]) placements[loserId] = p++;
        });
            return placements;
    },

    async saveTeamStats(tournamentId, fixtures, teams) {
        const realFx = fixtures.filter(f => !f.is_bye && f.status === 'completed');
        const statsMap = {};
        teams.forEach(t => {
            if (!t.master_team) return;
            const masterId = typeof t.master_team === 'object' ? t.master_team.id : t.master_team;
            statsMap[t.id] = { masterId, wins: 0, losses: 0, points_for: 0, points_against: 0, group_name: t.group_name || null };
        });
        realFx.forEach(f => {
            const resolveId = v => typeof v === 'object' ? v?.id : v;
            const home = statsMap[resolveId(f.home_team)], away = statsMap[resolveId(f.away_team)];
            if (home) {
                home.points_for += (f.home_score || 0); home.points_against += (f.away_score || 0);
                (f.home_score || 0) > (f.away_score || 0) ? home.wins++ : home.losses++;
            }
            if (away) {
                away.points_for += (f.away_score || 0); away.points_against += (f.home_score || 0);
                (f.away_score || 0) > (f.home_score || 0) ? away.wins++ : away.losses++;
            }
        });
        const placements = ScoreDB._computePlacements(fixtures);
        for (const [teamId, stat] of Object.entries(statsMap)) {
            if (!stat.masterId) continue;
            try {
                const existing = await pb.collection('team_stats').getFullList({
                    filter: `master_team="${stat.masterId}"&&tournament="${tournamentId}"`, requestKey: null,
                });
                const data = {
                    master_team: stat.masterId, tournament: tournamentId, wins: stat.wins, losses: stat.losses,
                    points_for: stat.points_for, points_against: stat.points_against,
                    placement: placements[teamId] ?? null, group_name: stat.group_name,
                };
                existing.length
                ? await pb.collection('team_stats').update(existing[0].id, data)
                : await pb.collection('team_stats').create(data);
            } catch (e) { console.warn('saveTeamStats failed for', stat.masterId, e.message); }
        }
    },
};

const Scores = {
    tournaments: [],
    currentTournamentId: null,
    teams: [],
    fixtures: [],
    filter: 'unscored',
    _activeFixture: null,

    async init() {
        await Shell.injectNav();
        Shell.renderAuthBar(pb);

        if (!_Auth.canScore()) {
            document.getElementById('not-scorer-notice').style.display = '';
            return;
        }
        document.getElementById('scores-body').style.display = '';
        _setConn(await _health());

        try {
            Scores.tournaments = await pb.collection('tournaments').getFullList({
                filter: `status="active"||status="completed"`, sort: '-updated',
                fields: 'id,name,event_name,status,format', requestKey: null,
            });
            const picker = document.getElementById('scores-tournament-picker');
            if (!Scores.tournaments.length) {
                picker.innerHTML = '<option value="">No active tournaments</option>';
                return;
            }
            picker.innerHTML = Scores.tournaments.map(t =>
            `<option value="${t.id}">${escHtml(t.event_name ? t.event_name + ' — ' + t.name : t.name)}${t.status === 'completed' ? ' (completed)' : ''}</option>`
            ).join('');
            Scores.currentTournamentId = Scores.tournaments[0].id;
            await Scores.load();
        } catch (e) {
            _showErr(`Could not load tournaments: ${e.message}`);
        }
    },

    onTournamentChange() {
        Scores.currentTournamentId = document.getElementById('scores-tournament-picker').value;
        Scores.load();
    },

    setFilter(f, btn) {
        Scores.filter = f;
        document.querySelectorAll('#scores-filter-tabs .tab').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        Scores.render();
    },

    async load() {
        if (!Scores.currentTournamentId) return;
        try {
            const [teams, fixtures] = await Promise.all([
                pb.collection('teams').getFullList({
                    filter: `tournament="${Scores.currentTournamentId}"`, expand: 'master_team', requestKey: null,
                }),
                pb.collection('fixtures').getFullList({
                    filter: `tournament="${Scores.currentTournamentId}"`, sort: 'round,match_number',
                    expand: 'home_team.master_team,away_team.master_team,court', requestKey: null,
                }),
            ]);
            Scores.teams = teams;
            Scores.fixtures = fixtures.filter(f => !f.is_bye && f.home_team && f.away_team);
            Scores.render();
        } catch (e) {
            _showErr(`Could not load fixtures: ${e.message}`);
        }
    },

    render() {
        const list = document.getElementById('scores-match-list');
        const today = new Date().toDateString();

        let fx = Scores.fixtures;
        if (Scores.filter === 'unscored') fx = fx.filter(f => f.status !== 'completed');
        if (Scores.filter === 'today') fx = fx.filter(f =>
            f.scheduled_start_time && new Date(f.scheduled_start_time).toDateString() === today
        );

        if (!fx.length) {
            list.innerHTML = `<div class="empty-state" style="padding:1.5rem 0;">
            <span class="empty-icon">🏀</span>
            ${Scores.filter === 'unscored' ? 'Everything here is scored.' : 'No matches match this filter.'}
            </div>`;
            return;
        }

        list.innerHTML = fx.map(f => {
            const home = teamDisplayName(f.expand?.home_team);
            const away = teamDisplayName(f.expand?.away_team);
            const done = f.status === 'completed';
            const court = f.expand?.court?.court_name || f.court_label || '';
            const label = f.round_label || f.group_name || `Round ${f.round}`;
            return `<div class="qs-match-row" onclick="Scores.openModal('${f.id}')">
            <span>
            <strong>${escHtml(home)}</strong> vs <strong>${escHtml(away)}</strong>
            <div style="font-size:11px;color:var(--text-tertiary);">${escHtml(label)}${done ? ` · ${f.home_score}–${f.away_score}` : ''}</div>
            </span>
            <span class="qs-court-tag">${done ? '✓ Scored' : (court ? escHtml(court) : 'Tap to score')}</span>
            </div>`;
        }).join('');
    },

    openModal(fixtureId) {
        const f = Scores.fixtures.find(x => x.id === fixtureId);
        if (!f) return;
        Scores._activeFixture = f;

        document.getElementById('qs-modal-title').textContent = f.status === 'completed' ? 'Edit result' : 'Enter result';
        document.getElementById('qs-home-name').textContent = f.expand?.home_team?.name || 'Home';
        document.getElementById('qs-away-name').textContent = f.expand?.away_team?.name || 'Away';
        document.getElementById('qs-home-label').textContent = teamDisplayName(f.expand?.home_team);
        document.getElementById('qs-away-label').textContent = teamDisplayName(f.expand?.away_team);
        document.getElementById('qs-score-home').value = f.status === 'completed' ? f.home_score : '';
        document.getElementById('qs-score-away').value = f.status === 'completed' ? f.away_score : '';
        document.getElementById('qs-modal-error').classList.remove('visible');
        document.getElementById('qs-save-toast').classList.remove('visible');
        document.getElementById('score-entry-modal').classList.add('open');
        document.getElementById('qs-score-home').focus();
    },

    closeModal() {
        document.getElementById('score-entry-modal').classList.remove('open');
        Scores._activeFixture = null;
    },

    async save() {
        const f = Scores._activeFixture;
        if (!f) return;
        const errEl = document.getElementById('qs-modal-error');
        errEl.classList.remove('visible');

        const homeScore = parseInt(document.getElementById('qs-score-home').value, 10);
        const awayScore = parseInt(document.getElementById('qs-score-away').value, 10);
        if (isNaN(homeScore) || isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
            errEl.textContent = 'Enter valid scores for both teams.'; errEl.classList.add('visible'); return;
        }
        if (homeScore === awayScore) {
            errEl.textContent = 'Scores cannot be equal — there must be a winner.'; errEl.classList.add('visible'); return;
        }

        const tournament = Scores.tournaments.find(t => t.id === Scores.currentTournamentId);
        const winnerId = homeScore > awayScore ? f.home_team : f.away_team;
        const isBracketMatch = tournament.format === 'elimination' ||
        (tournament.format === 'group_stage' && !f.group_name);
        const winnerChanging = f.status === 'completed' && isBracketMatch && f.winner && f.winner !== winnerId;

        if (winnerChanging) {
            const impact = await ScoreDB.getBracketImpact(f.tournament, f.round, f.match_number);
            if (impact.length) {
                const names = impact.map(fx => `R${fx.round}: ${fx.home_score}–${fx.away_score}`).join('\n');
                if (!confirm(`Changing this result resets ${impact.length} already-played downstream match(es), which will need to be replayed:\n\n${names}\n\nContinue?`)) return;
            }
        }

        const btn = document.getElementById('qs-save-btn');
        btn.disabled = true; btn.textContent = 'Saving…';

        try {
            const wasCompletedBefore = tournament.status === 'completed';
            await ScoreDB.saveFixtureResult(f.id, homeScore, awayScore, winnerId);

            let resetFixtures = [];
            if (isBracketMatch) resetFixtures = await ScoreDB.cascadeReseed(f.tournament, f.round, f.match_number, winnerId);

            let groupJustFinished = false;
            if (tournament.format === 'group_stage') {
                groupJustFinished = await ScoreDB.seedKnockoutFromGroups(f.tournament, Scores.teams);
            }

            const freshFixtures = await pb.collection('fixtures').getFullList({
                filter: `tournament="${f.tournament}"`, sort: 'round,match_number', requestKey: null,
            });
            const allDone = freshFixtures.filter(x => !x.is_bye).every(x => x.status === 'completed');
            const newStatus = allDone ? 'completed' : 'active';
            await pb.collection('tournaments').update(f.tournament, { status: newStatus });
            tournament.status = newStatus;

            if (allDone) {
                await ScoreDB.saveTeamStats(f.tournament, freshFixtures, Scores.teams);
            } else if (wasCompletedBefore && resetFixtures.length) {
                const stale = await pb.collection('team_stats').getFullList({
                    filter: `tournament="${f.tournament}"`, fields: 'id', requestKey: null,
                });
                await Promise.all(stale.map(s => pb.collection('team_stats').delete(s.id)));
            }

            Scores.closeModal();
            await Scores.load();

            const toast = document.getElementById('qs-save-toast');
            toast.textContent = resetFixtures.length
            ? `Saved — ${resetFixtures.length} downstream match(es) reset.`
            : (groupJustFinished ? 'Saved — knockout stage seeded.' : 'Saved.');
            toast.classList.add('visible');
            setTimeout(() => toast.classList.remove('visible'), 3000);

        } catch (e) {
            errEl.textContent = `Save failed: ${e.message}`; errEl.classList.add('visible');
        } finally {
            btn.disabled = false; btn.textContent = 'Save & Publish';
        }
    },
};

async function _health() { try { await pb.health.check(); return true; } catch (e) { return false; } }
function _setConn(online) {
    const dot = document.getElementById('conn-dot'), label = document.getElementById('conn-label');
    if (dot) dot.className = 'conn-dot ' + (online ? 'online' : 'offline');
    if (label) label.textContent = online ? 'Connected' : 'Offline';
}
function _showErr(msg) {
    document.getElementById('scores-error-msg').textContent = msg;
    document.getElementById('scores-error').classList.add('visible');
}

document.addEventListener('DOMContentLoaded', () => Scores.init().catch(e => console.error('Scores.init failed', e)));
