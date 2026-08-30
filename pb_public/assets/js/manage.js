/**
 * =============================================================================
 * manage.js — Operator-only authoring workflow: create categories, manage
 * rosters, generate fixtures, deadline/banner, manage teams, regenerate,
 * results, organise events, delete.
 *
 * This is everything that used to live inside index.html's screen-setup /
 * screen-names / screen-fixtures admin bits — physically relocated so the
 * public home page has zero admin code paths, hidden or otherwise.
 *
 * Read views (schedule/bracket/standings) are NOT duplicated here — the
 * hub screen links out to the existing public pages (fixtures.html,
 * bracket.html, standings.html) which already render them safely. Actual
 * score entry lives entirely in scores.html, not here.
 *
 * Depends on: config.js, logger.js, auth.js (pb, Auth), state.js (State,
 * UI, FORMATS, suggestFormat), generators.js, events.js, db.js, shell.js
 * =============================================================================
 */

const Manage = {

    activeTournament : null,
    teams            : [],
    masterTeams      : [],
    fixtures         : [],   // lightweight — id/status/is_bye/round/home_team/away_team only
    _manualPoolCount : 2,
    _categoryRowCounter: 0,

    async init() {
        await Shell.injectNav();
        Shell.renderAuthBar(pb);

        if (!Auth.isAdmin()) {
            document.getElementById('not-admin-notice').style.display = '';
            Logger.info('Manage.init blocked — not an admin');
            return;
        }
        document.getElementById('manage-app').style.display = '';
        Manage._initSetupScreen();
        await Manage.loadList();
    },

    /* ── LIST SCREEN ─────────────────────────────────────────────────────── */

    goToList() { UI.showScreen('screen-manage-home'); return Manage.loadList(); },

    async loadList() {
        UI.clearError('manage-list-error');
        const list = document.getElementById('manage-list');
        list.innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div>';

        try {
            const [tournaments, teamCounts] = await Promise.all([
                DB.getTournaments(), DB.getAllTeamCounts(),
            ]);
            State.tournaments = tournaments;
            State.teamCounts  = teamCounts;

            if (!tournaments.length) {
                list.innerHTML = `<div class="empty-state"><span class="empty-icon">🏆</span>No tournaments yet. Create one to get started.</div>`;
                return;
            }

            const active    = tournaments.filter(t => t.status === 'active');
            const pending   = tournaments.filter(t => t.status === 'pending');
            const completed = tournaments.filter(t => t.status === 'completed');

            list.innerHTML =
            Manage._renderSection('Active', active) +
            Manage._renderSection('Upcoming', pending) +
            Manage._renderSection('Completed', completed);

        } catch (e) {
            Logger.error('Manage.loadList failed', { error: e.message });
            UI.showError('manage-list-error', 'manage-list-error-msg', `Could not load: ${e.message}`);
            list.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span>Couldn't load tournaments.</div>`;
        }
    },

    _renderSection(title, items) {
        if (!items.length) return '';
        const events = {}, standalone = [];
        items.forEach(t => {
            const ev = (t.event_name || '').trim();
            if (ev) { (events[ev] = events[ev] || []).push(t); } else { standalone.push(t); }
        });
        let inner = '';
        Object.keys(events).sort().forEach(evName => { inner += Manage._renderEventGroup(evName, events[evName]); });
        standalone.forEach(t => { inner += Manage._renderCategoryRow(t, false); });
        return `<div class="section-heading">${escHtml(title)}</div>${inner}`;
    },

    _renderEventGroup(eventName, categories) {
        const rows = categories.map(t => Manage._renderCategoryRow(t, true)).join('');
        return `<div style="background:var(--bg-primary);border:0.5px solid var(--border-light);border-radius:var(--radius-lg);margin-bottom:10px;overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0.85rem 1rem;background:var(--bg-secondary);border-bottom:0.5px solid var(--border-light);flex-wrap:wrap;gap:8px;">
        <div style="font-weight:600;font-size:14px;">🏆 ${escHtml(eventName)}</div>
        <button class="btn sm primary" onclick="Manage.goToSetupForEvent('${escHtml(eventName).replace(/'/g, "\\'")}')">+ Add category</button>
        </div>
        <div style="padding:6px 0;">${rows}</div>
        </div>`;
    },

    _renderCategoryRow(t, indent) {
        const formatText = t.format.replace(/_/g, ' ');
        const actionBtn = t.status === 'pending'
        ? `<button class="btn sm ghost" onclick="Manage.resumeSetup('${t.id}')">✎ Resume setup</button>`
        : `<button class="btn sm ghost" onclick="Manage.openHub('${t.id}')">Manage →</button>`;
        const deleteBtn = `<button class="btn sm danger" onclick="Manage.deleteTournament('${t.id}','${escHtml(t.name).replace(/'/g, "\\'")}')">Delete</button>`;
        return `<div style="display:flex;align-items:center;justify-content:space-between;
        padding:${indent ? '0.6rem 1rem 0.6rem 2rem' : '0.85rem 1rem'};border-bottom:0.5px solid var(--border-light);flex-wrap:wrap;gap:8px;">
        <div>
        <div style="font-size:${indent ? '13px' : '14px'};font-weight:500;display:flex;align-items:center;gap:6px;">
        ${indent ? '<span style="font-size:11px;color:var(--text-tertiary)">↳</span>' : ''}${escHtml(t.name)}
        </div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">${formatText} · ${State.teamCounts?.[t.id] || 0} teams</div>
        ${Manage._deadlineBadge(t.registration_deadline)}
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <span class="status-badge badge-${t.status}">${Manage._statusLabel(t.status)}</span>
        ${actionBtn}
        <a class="btn sm ghost" href="tournament.html?id=${t.id}" target="_blank">View public →</a>
        ${deleteBtn}
        </div>
        </div>`;
    },

    _statusLabel(status) { return { pending: 'Not yet started', active: 'Ongoing', completed: 'Complete' }[status] || status; },

    _deadlineBadge(deadline) {
        if (!deadline) return '';
        const isLocked = new Date(deadline) < new Date();
        const dateStr = new Date(deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        return isLocked
        ? `<div style="font-size:11px;color:var(--text-warning);margin-top:2px;">🔒 Locked since ${dateStr}</div>`
        : `<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">Registration closes ${dateStr}</div>`;
    },

    async deleteTournament(id, name) {
        if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
        try {
            const [stats, favs] = await Promise.all([
                pb.collection('team_stats').getFullList({ filter: `tournament="${id}"`, fields: 'id', requestKey: null }),
                                                    pb.collection('favourites').getFullList({ filter: `tournament="${id}"`, fields: 'id', requestKey: null }),
            ]);
            await Promise.all([
                ...stats.map(s => pb.collection('team_stats').delete(s.id)),
                              ...favs.map(f => pb.collection('favourites').delete(f.id)),
            ]);
            await DB.deleteTournament(id);
            await Manage.loadList();
        } catch (e) {
            Logger.error('Manage.deleteTournament failed', { error: e.message });
            UI.showError('manage-list-error', 'manage-list-error-msg', `Delete failed: ${e.message}`);
        }
    },

    /* ── SETUP SCREEN ────────────────────────────────────────────────────── */

    goToSetup() {
        State.setupData = { eventName: null, eventSeries: null, eventEdition: null, name: '', names: [], masterRefs: [] };
        const el = id => document.getElementById(id);
        if (el('event-series'))  { el('event-series').value = ''; el('event-series').readOnly = false; el('event-series').style.opacity = ''; el('event-series').style.background = ''; }
        if (el('event-edition')) { el('event-edition').value = ''; el('event-edition').readOnly = false; el('event-edition').style.opacity = ''; el('event-edition').style.background = ''; }
        if (el('registration-deadline'))   el('registration-deadline').value = '';
        if (el('tournament-banner'))       el('tournament-banner').value = '';
        if (el('tournament-name-preview')) el('tournament-name-preview').textContent = '';

        const list = el('categories-list');
        if (list) list.innerHTML = '';
        Manage._categoryRowCounter = 0;
        Manage.addCategoryRow();
        Manage._populateEventSuggestions();
        UI.showScreen('screen-manage-setup');
    },

    goToSetupForEvent(eventName) {
        const match = eventName.match(/^(.+?)\s+([\d][^\s]*)$/);
        const series = match ? match[1].trim() : eventName;
        const edition = match ? match[2].trim() : '';
        State.setupData = { eventName, eventSeries: series, eventEdition: edition || null, name: '', names: [], masterRefs: [] };

        const el = id => document.getElementById(id);
        const seriesEl = el('event-series');
        if (seriesEl) {
            seriesEl.value = series; seriesEl.readOnly = true;
            seriesEl.style.opacity = '0.7'; seriesEl.style.background = 'var(--bg-tertiary)';
            seriesEl.title = `Part of "${eventName}" — series locked`;
        }
        const editionEl = el('event-edition');
        if (editionEl) { editionEl.value = edition; editionEl.readOnly = false; editionEl.style.opacity = ''; editionEl.style.background = ''; }
        if (el('registration-deadline')) el('registration-deadline').value = '';
        if (el('tournament-banner'))     el('tournament-banner').value = '';
        if (el('tournament-name-preview')) el('tournament-name-preview').textContent = `Adding category to: "${eventName}"`;

        const list = el('categories-list');
        if (list) list.innerHTML = '';
        Manage._categoryRowCounter = 0;
        Manage.addCategoryRow();
        Manage._populateEventSuggestions();
        UI.showScreen('screen-manage-setup');
    },

    _initSetupScreen() {
        const updatePreview = () => {
            const series  = (document.getElementById('event-series')?.value  || '').trim();
            const edition = (document.getElementById('event-edition')?.value || '').trim();
            const full    = [series, edition].filter(Boolean).join(' ');
            const preview = document.getElementById('tournament-name-preview');
            if (preview) preview.textContent = full ? `Saving as: "${full}"` : '';
            State.setupData.eventSeries  = series  || null;
            State.setupData.eventEdition = edition || null;
            State.setupData.eventName    = full    || null;
        };
        document.getElementById('event-series')?.addEventListener('input', updatePreview);
        document.getElementById('event-edition')?.addEventListener('input', updatePreview);
    },

    async _populateEventSuggestions() {
        const datalist = document.getElementById('event-series-suggestions');
        if (!datalist) return;
        try {
            const all = await pb.collection('tournaments').getFullList({ fields: 'event_series,event_name', requestKey: null });
            const series = [...new Set(all.map(t => t.event_series || t.event_name?.match(/^(.+?)\s+[\d]/)?.[1] || t.event_name).filter(Boolean))].sort();
            datalist.innerHTML = series.map(s => `<option value="${escHtml(s)}">`).join('');
        } catch (e) { Logger.warn('_populateEventSuggestions failed', { error: e.message }); }
    },

    addCategoryRow(prefill = null) {
        const rowId = `cat-row-${Manage._categoryRowCounter++}`;
        const list  = document.getElementById('categories-list');
        if (!list) return rowId;

        const GENDERS = ['Boys', 'Girls', 'Mixed', 'Men', 'Women'];
        const checked = prefill?.genders || ['Boys'];

        const div = document.createElement('div');
        div.className = 'category-row';
        div.dataset.rowId = rowId;
        div.style.cssText = 'border:0.5px solid var(--border-light);border-radius:var(--radius-md);padding:12px;margin-bottom:10px;background:var(--bg-secondary);';
        div.innerHTML = `
        <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">
        <select class="cat-age-group tournament-name-input" style="flex:1;margin-bottom:0;">
        <option value="">Age group</option>
        <option value="U10">U10</option><option value="U12">U12</option><option value="U13">U13</option>
        <option value="U14">U14</option><option value="U16">U16</option><option value="U19">U19</option>
        <option value="Senior">Senior</option><option value="Open">Open</option>
        </select>
        <button type="button" class="btn sm ghost" onclick="Manage.removeCategoryRow('${rowId}')" title="Remove category">✕</button>
        </div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;">
        ${GENDERS.map(g => `
            <label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;">
            <input type="checkbox" class="cat-gender-check" value="${g}" ${checked.includes(g) ? 'checked' : ''} style="width:16px;height:16px;">
            ${g}
            </label>`).join('')}
            </div>`;
            list.appendChild(div);
            if (prefill?.ageGroup) div.querySelector('.cat-age-group').value = prefill.ageGroup;
            return rowId;
    },

    removeCategoryRow(rowId) {
        const list = document.getElementById('categories-list');
        const rows = list?.querySelectorAll('.category-row') || [];
        if (rows.length <= 1) return;
        list.querySelector(`[data-row-id="${rowId}"]`)?.remove();
    },

    async goToNames() {
        UI.clearError('setup-error');
        const series  = (document.getElementById('event-series')?.value  || '').trim();
        const edition = (document.getElementById('event-edition')?.value || '').trim();

        if (!series) {
            UI.showError('setup-error', 'setup-error-msg', 'Please enter a tournament name.');
            document.getElementById('event-series')?.focus();
            return;
        }
        const rows = [...document.querySelectorAll('#categories-list .category-row')];
        if (!rows.length) { UI.showError('setup-error', 'setup-error-msg', 'Add at least one category.'); return; }

        const specs = []; const seen = new Set();
        for (const row of rows) {
            const ageGroup = row.querySelector('.cat-age-group')?.value || '';
            const genders  = [...row.querySelectorAll('.cat-gender-check:checked')].map(cb => cb.value);
            if (!ageGroup) { UI.showError('setup-error', 'setup-error-msg', 'Every category needs an age group.'); return; }
            if (!genders.length) { UI.showError('setup-error', 'setup-error-msg', `Check at least one gender for ${ageGroup}.`); return; }
            for (const gender of genders) {
                const key = `${ageGroup}|${gender}`;
                if (seen.has(key)) { UI.showError('setup-error', 'setup-error-msg', `Duplicate category: ${ageGroup} ${gender}.`); return; }
                seen.add(key); specs.push({ ageGroup, gender });
            }
        }

        const eventName = [series, edition].filter(Boolean).join(' ');
        const deadlineEl = document.getElementById('registration-deadline');
        const registrationDeadline = deadlineEl?.value ? new Date(`${deadlineEl.value}T23:59:59`).toISOString() : null;

        const btn = event?.target;
        if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
        try {
            const created = [];
            for (const spec of specs) {
                const name = [spec.ageGroup, spec.gender].filter(Boolean).join(' ') || 'Open';
                const tournament = await DB.createTournament(name, 'round_robin', eventName || null, series || null, edition || null, registrationDeadline, spec.gender, spec.ageGroup, null);
                created.push(tournament);
            }
            const bannerEl = document.getElementById('tournament-banner');
            if (bannerEl?.files?.[0]) {
                for (const t of created) {
                    try { await DB.uploadTournamentBanner(t.id, bannerEl.files[0]); }
                    catch (e) { Logger.warn('Banner upload failed for one category', { error: e.message }); }
                }
            }
            await Manage.goToList();
            const msg = created.length > 1
            ? `Created ${created.length} categories under "${eventName}". Add teams as they register — no rush.`
            : `"${created[0].name}" created. Add teams as they register — no rush.`;
            UI.showSuccess('manage-list-success', 'manage-list-success-msg', msg);
        } catch (e) {
            Logger.error('Category creation failed', { error: e.message });
            UI.showError('setup-error', 'setup-error-msg', `Couldn't create: ${e.message}`);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Create categories →'; }
        }
    },

    /* ── ROSTER SCREEN ───────────────────────────────────────────────────── */

    async resumeSetup(tournamentId) {
        try {
            const tournament = await pb.collection('tournaments').getOne(tournamentId);
            const fx = await pb.collection('fixtures').getFullList({ filter: `tournament="${tournamentId}"`, fields: 'id', requestKey: null });
            if (fx.length > 0) { await Manage.openHub(tournamentId); return; }
            await Manage._renderRosterScreen(tournament);
            UI.showScreen('screen-manage-names');
        } catch (e) {
            Logger.error('Manage.resumeSetup failed', { error: e.message });
            UI.showError('manage-list-error', 'manage-list-error-msg', `Couldn't open: ${e.message}`);
        }
    },

    async _renderRosterScreen(tournament) {
        Manage.activeTournament = tournament;
        const [teams, masterTeams] = await Promise.all([DB.getTeams(tournament.id), DB.getMasterTeams()]);
        Manage.teams = teams; Manage.masterTeams = masterTeams;

        const progressEl = document.getElementById('category-progress');
        if (progressEl) progressEl.textContent = '';

        const rosterIds = new Set(teams.map(t => t.expand?.master_team?.id).filter(Boolean));
        const available = masterTeams.filter(mt => !rosterIds.has(mt.id));
        const n = teams.length;
        const suggested = suggestFormat(n || 8);
        const format = tournament.format || suggested;

        const grid = document.getElementById('team-inputs');
        if (!grid) return;

        grid.innerHTML = `
        <div class="pool-assignment-row" style="margin-bottom:1.5rem;">
        <div>${Manage._deadlineEditor(tournament)}${Manage._bannerEditor(tournament)}</div>
        <div>
        <div style="font-size:13px;font-weight:600;margin-bottom:8px;">Format</div>
        <div id="roster-format-grid" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;"></div>
        <div id="roster-pool-size-row" style="display:none;margin-bottom:10px;">
        <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px;">Number of pools</label>
        <input type="number" id="roster-pool-count-input" min="2" max="8" value="2" class="tournament-name-input"
        style="margin-bottom:8px;max-width:100px;" onchange="Manage._renderPoolAssignmentUI('${tournament.id}', this.value)">
        </div>
        </div>
        </div>

        <div class="pool-assignment-row">
        <div id="roster-pool-assignment-wrap" style="display:none;"></div>
        <div id="roster-format-preview-wrap" style="display:block;">
        <div style="font-size:13px;font-weight:600;margin-bottom:8px;">Matchup preview</div>
        <div id="roster-format-preview"></div>
        </div>
        </div>

        <div style="margin-bottom:1rem;margin-top:1.5rem;">
        <div style="font-size:13px;font-weight:600;margin-bottom:8px;">
        Roster — ${teams.length} team${teams.length === 1 ? '' : 's'} registered
        ${tournament.max_teams ? ` / ${tournament.max_teams} expected` : ''}
        </div>
        ${teams.length ? teams.map(t => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:0.5px solid var(--border-light);font-size:13px;">
            <span>${escHtml(t.name)}</span>
            <button class="btn sm ghost" onclick="Manage.removeRosterTeam('${t.id}')">Remove</button>
            </div>`).join('') : '<p style="font-size:12px;color:var(--text-tertiary);">No teams yet.</p>'}
            </div>

            <div style="margin-bottom:1rem;">
            <div style="font-size:13px;font-weight:600;margin-bottom:8px;">Add a registered team</div>
            ${available.length ? `
                <select id="roster-add-select" class="tournament-name-input" style="margin-bottom:6px;">
                <option value="">Select a team…</option>
                ${available.map(mt => `<option value="${mt.id}">${escHtml(mt.name)}</option>`).join('')}
                </select>
                <button class="btn primary" style="width:100%;" onclick="Manage.addRosterTeam()">+ Add to roster</button>
                ` : `<p style="font-size:12px;color:var(--text-tertiary);">Every registered team is already on this roster.
                <a href="teams.html" style="color:var(--accent);">Register another team</a></p>`}
                </div>`;

                Manage._renderRosterFormatGrid(tournament.id, format, n);
    },

    _renderRosterFormatGrid(tournamentId, current, teamCount) {
        const gridEl = document.getElementById('roster-format-grid');
        if (!gridEl) return;
        const suggested = teamCount ? suggestFormat(teamCount) : null;

        gridEl.innerHTML = FORMATS.map(f => `
        <button type="button" class="btn sm ${f.id === current ? 'primary' : 'ghost'}"
        onclick="Manage.setRosterFormat('${tournamentId}', '${f.id}')">
        ${f.icon} ${f.name}${f.id === suggested ? ' ★' : ''}
        </button>`).join('');

        const poolRow = document.getElementById('roster-pool-size-row');
        const poolInput = document.getElementById('roster-pool-count-input');
        const assignWrap = document.getElementById('roster-pool-assignment-wrap');
        const isGroupStage = current === 'group_stage';
        if (poolRow) poolRow.style.display = isGroupStage ? 'block' : 'none';
        if (assignWrap) assignWrap.style.display = isGroupStage ? 'block' : 'none';

        if (isGroupStage) {
            const poolCount = Manage._manualPoolCount || 2;
            if (poolInput) poolInput.value = poolCount;
            Manage._renderPoolAssignmentUI(tournamentId, poolCount);
        }
        Manage._renderFormatPreview(current);
    },

    _renderPoolAssignmentUI(tournamentId, poolCountRaw) {
        const poolCount = Math.max(2, Math.min(8, parseInt(poolCountRaw, 10) || 2));
        Manage._manualPoolCount = poolCount;
        const wrap = document.getElementById('roster-pool-assignment-wrap');
        if (!wrap) return;

        const teams = Manage.teams || [];
        if (teams.length < 2) {
            wrap.innerHTML = `<p style="font-size:12px;color:var(--text-tertiary);font-style:italic;">Add at least 2 teams before assigning pools.</p>`;
            return;
        }

        const letters = 'ABCDEFGH'.slice(0, poolCount).split('');
        const poolCounts = {}; letters.forEach(l => poolCounts[l] = 0);
        teams.forEach(t => { if (t.group_name && poolCounts[t.group_name] !== undefined) poolCounts[t.group_name]++; });
        const countsLine = letters.map(l => `Pool ${l}: ${poolCounts[l]}`).join(' · ');

        wrap.innerHTML = `
        <div style="font-size:13px;font-weight:600;margin-bottom:6px;">Pool assignment</div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:8px;">${countsLine} — leave "Unassigned" to auto-distribute.</div>
        <div style="max-height:260px;overflow-y:auto;border:0.5px solid var(--border-light);border-radius:var(--radius-md);padding:8px;">
        ${teams.map(t => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:0.5px solid var(--border-light);font-size:13px;gap:8px;">
            <span style="flex:1;">${escHtml(t.name)}</span>
            <select class="tournament-name-input" style="margin-bottom:0;width:140px;" onchange="Manage.savePoolAssignment('${t.id}', this.value)">
            <option value="">Unassigned</option>
            ${letters.map(l => `<option value="${l}" ${t.group_name === l ? 'selected' : ''}>Pool ${l}</option>`).join('')}
            </select>
            </div>`).join('')}
            </div>`;
    },

    async savePoolAssignment(teamId, poolLetter) {
        try {
            await pb.collection('teams').update(teamId, { group_name: poolLetter || null });
            const t = Manage.teams.find(t => t.id === teamId);
            if (t) t.group_name = poolLetter || null;
            Manage._renderPoolAssignmentUI(Manage.activeTournament.id, Manage._manualPoolCount || 2);
            Manage._renderFormatPreview('group_stage');
        } catch (e) {
            Logger.error('savePoolAssignment failed', { error: e.message });
            alert(`Couldn't save pool assignment: ${e.message}`);
        }
    },

    _renderFormatPreview(formatId) {
        const previewEl = document.getElementById('roster-format-preview');
        if (!previewEl) return;
        const teams = Manage.teams || [];
        if (teams.length < 2) {
            previewEl.innerHTML = `<p style="font-size:12px;color:var(--text-tertiary);font-style:italic;">Add at least 2 teams to see a preview.</p>`;
            return;
        }

        let generated;
        if (formatId === 'round_robin') generated = genRoundRobin(teams.map(t => t.name));
        else if (formatId === 'elimination') generated = genElimination(teams.map(t => t.name));
        else {
            const poolCount = Manage._manualPoolCount || 2;
            const groups = buildManualGroups(teams, poolCount);
            generated = genGroupStageFromGroups(groups);
        }

        const matchRow = m => `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;">
        <span>${escHtml(m.a)}</span><span style="color:var(--text-tertiary);">vs</span><span>${escHtml(m.b)}</span></div>`;
        const roundBlock = round => `<div style="margin-bottom:8px;">
        <div style="font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.03em;margin-bottom:2px;">${escHtml(round.label)}</div>
        ${round.matches.filter(m => !m.isBye).map(matchRow).join('') || '<div style="font-size:12px;color:var(--text-tertiary);">Bye</div>'}
        </div>`;

        let bodyHtml;
        if (generated.type === 'group_stage') {
            bodyHtml = generated.groupFixtures.map(g => `
            <div style="margin-bottom:10px;">
            <div style="font-size:12px;font-weight:600;margin-bottom:4px;">${escHtml(g.name)} (${g.teams.length} teams)</div>
            ${g.rounds.map(roundBlock).join('')}
            </div>`).join('') + `<p style="font-size:11px;color:var(--text-tertiary);font-style:italic;margin-top:6px;">
            Then: top 2 from each group advance to a ${generated.knockout.rounds.length}-round knockout stage.</p>`;
        } else {
            bodyHtml = generated.rounds.map(roundBlock).join('');
        }

        previewEl.innerHTML = `
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">
        Preview with the current ${teams.length} team${teams.length === 1 ? '' : 's'} — ${generated.totalMatches} matches total.
        </div>
        <div style="max-height:280px;overflow-y:auto;border:0.5px solid var(--border-light);border-radius:var(--radius-md);padding:10px;">${bodyHtml}</div>`;
    },

    async setRosterFormat(tournamentId, formatId) {
        try {
            await DB.updateTournament(tournamentId, { format: formatId });
            Manage.activeTournament.format = formatId;
            Manage._renderRosterFormatGrid(tournamentId, formatId, Manage.teams.length);
        } catch (e) {
            Logger.error('setRosterFormat failed', { error: e.message });
            alert(`Couldn't update format: ${e.message}`);
        }
    },

    async addRosterTeam() {
        const select = document.getElementById('roster-add-select');
        const masterTeamId = select?.value;
        if (!masterTeamId) return;
        const masterTeam = Manage.masterTeams.find(mt => mt.id === masterTeamId);
        if (!masterTeam) return;
        try {
            await DB.createTeam(Manage.activeTournament.id, masterTeam.name, Manage.teams.length + 1, null, masterTeam.id);
            await Manage._renderRosterScreen(Manage.activeTournament);
        } catch (e) {
            Logger.error('addRosterTeam failed', { error: e.message });
            alert(`Couldn't add team: ${e.message}`);
        }
    },

    async removeRosterTeam(teamId) {
        try {
            await pb.collection('teams').delete(teamId);
            await Manage._renderRosterScreen(Manage.activeTournament);
        } catch (e) {
            Logger.error('removeRosterTeam failed', { error: e.message });
            alert(`Couldn't remove team: ${e.message}`);
        }
    },

    async generateFixturesForRoster() {
        const tournament = Manage.activeTournament;
        const teams = Manage.teams || [];
        if (teams.length < 3) { alert('Add at least 3 teams before generating fixtures.'); return; }

        const btn = document.getElementById('btn-generate-roster');
        if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
        try {
            const format = tournament.format || suggestFormat(teams.length);
            let generated;
            if (format === 'group_stage') {
                const poolCount = Manage._manualPoolCount || new Set(teams.map(t => t.group_name).filter(Boolean)).size || 2;
                const groups = buildManualGroups(teams, poolCount);
                const finalGroupOf = {};
                groups.forEach(g => { const letter = g.name.replace('Group ', ''); g.teams.forEach(name => { finalGroupOf[name] = letter; }); });
                for (const t of teams) {
                    const finalGroup = finalGroupOf[t.name] || null;
                    if (finalGroup && t.group_name !== finalGroup) await pb.collection('teams').update(t.id, { group_name: finalGroup });
                }
                generated = genGroupStageFromGroups(groups);
            } else if (format === 'elimination') {
                generated = genElimination(teams.map(t => t.name));
            } else {
                generated = genRoundRobin(teams.map(t => t.name));
            }

            const teamMap = {}; teams.forEach(t => { teamMap[t.name] = t.id; });
            await Manage._persistFixtures(tournament.id, generated, teamMap);
            await DB.updateTournament(tournament.id, { status: 'active' });
            Manage.activeTournament.status = 'active';

            await Manage.openHub(tournament.id);
            UI.showSuccess('hub-success', 'hub-success-msg', `"${tournament.name}" — ${generated.totalMatches} matches generated.`);
        } catch (e) {
            Logger.error('generateFixturesForRoster failed', { error: e.message });
            alert(`Couldn't generate fixtures: ${e.message}`);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Generate fixtures →'; }
        }
    },

    async _persistFixtures(tournamentId, generated, teamMap) {
        if (generated.type === 'elimination') {
            const savedFixtureMap = {};
            for (const round of generated.rounds) {
                for (let mi = 0; mi < round.matches.length; mi++) {
                    const m = round.matches[mi];
                    const key = `R${round.roundNumber}M${mi + 1}`;
                    const homeId = (!m.isBye && m.a !== 'TBD' && teamMap[m.a]) ? teamMap[m.a] : null;
                    const awayId = (!m.isBye && m.b !== 'TBD' && m.b !== 'BYE' && teamMap[m.b]) ? teamMap[m.b] : null;
                    const saved = await DB.createFixture({
                        tournament: tournamentId, round: round.roundNumber, match_number: mi + 1, round_label: round.label,
                        home_team: homeId, away_team: awayId, is_bye: m.isBye, status: m.isBye ? 'completed' : 'scheduled', group_name: null,
                    });
                    savedFixtureMap[key] = saved;
                }
            }
            for (let mi = 0; mi < generated.rounds[0].matches.length; mi++) {
                const m = generated.rounds[0].matches[mi];
                if (!m.isBye) continue;
                const slot = m.nextSlot === 'home' ? 'home_team' : 'away_team';
                const nextFx = savedFixtureMap[`R2M${m.nextMatchNumber}`];
                if (nextFx) await pb.collection('fixtures').update(nextFx.id, { [slot]: teamMap[m.a] });
            }
        } else if (generated.type === 'group_stage') {
            let roundOffset = 0;
            for (const group of generated.groupFixtures) {
                for (let ri = 0; ri < group.rounds.length; ri++) {
                    const round = group.rounds[ri];
                    for (let mi = 0; mi < round.matches.length; mi++) {
                        const m = round.matches[mi];
                        await DB.createFixture({
                            tournament: tournamentId, round: roundOffset + ri + 1, match_number: mi + 1, round_label: round.label,
                            home_team: teamMap[m.a] ?? null, away_team: teamMap[m.b] ?? null, is_bye: false, status: 'scheduled', group_name: group.name,
                        });
                    }
                }
                roundOffset += group.rounds.length;
            }
            for (let ri = 0; ri < generated.knockout.rounds.length; ri++) {
                const round = generated.knockout.rounds[ri];
                for (let mi = 0; mi < round.matches.length; mi++) {
                    const m = round.matches[mi];
                    await DB.createFixture({
                        tournament: tournamentId, round: roundOffset + ri + 1, match_number: mi + 1, round_label: round.label,
                        home_team: null, away_team: null, is_bye: m.isBye, status: 'scheduled', group_name: null,
                    });
                }
            }
        } else {
            for (let ri = 0; ri < generated.rounds.length; ri++) {
                const round = generated.rounds[ri];
                for (let mi = 0; mi < round.matches.length; mi++) {
                    const m = round.matches[mi];
                    await DB.createFixture({
                        tournament: tournamentId, round: ri + 1, match_number: mi + 1, round_label: round.label,
                        home_team: teamMap[m.a] ?? null, away_team: teamMap[m.b] ?? null, is_bye: false, status: 'scheduled', group_name: null,
                    });
                }
            }
        }
    },

    /* ── DEADLINE / BANNER EDITORS ───────────────────────────────────────── */

    _deadlineEditor(tournament) {
        const deadline = tournament.registration_deadline;
        const isLocked = deadline && new Date(deadline) < new Date();
        const dateStr = deadline ? new Date(deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
        const inputVal = deadline ? new Date(deadline).toISOString().slice(0, 10) : '';
        const statusLine = deadline
        ? (isLocked ? `<span style="color:var(--text-warning);">🔒 Locked since ${dateStr}</span>` : `<span style="color:var(--text-tertiary);">Registration closes ${dateStr}</span>`)
        : `<span style="color:var(--text-tertiary);">No deadline set</span>`;

        return `
        <div style="margin-bottom:0.75rem;padding:6px 10px;background:var(--bg-secondary);border-radius:var(--radius-md);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <div style="font-size:12px;">${statusLine}</div>
        <button class="btn sm ghost" onclick="Manage._toggleDeadlineEdit()">Edit deadline</button>
        </div>
        <div id="deadline-edit-row" style="display:none;margin-top:8px;gap:6px;">
        <input type="date" id="deadline-edit-input" value="${inputVal}" class="tournament-name-input" style="margin-bottom:6px;">
        <div style="display:flex;gap:6px;">
        <button class="btn sm primary" style="flex:1;" onclick="Manage.saveDeadline('${tournament.id}')">Save</button>
        <button class="btn sm ghost" onclick="Manage.saveDeadline('${tournament.id}', true)">Clear deadline</button>
        </div>
        <div id="deadline-edit-error" style="font-size:11px;color:var(--text-error);margin-top:6px;display:none;"></div>
        </div>
        </div>`;
    },

    _toggleDeadlineEdit() {
        const row = document.getElementById('deadline-edit-row');
        if (row) row.style.display = row.style.display === 'none' ? 'block' : 'none';
    },

    async saveDeadline(tournamentId, clear = false) {
        const errEl = document.getElementById('deadline-edit-error');
        if (errEl) errEl.style.display = 'none';
        const inputEl = document.getElementById('deadline-edit-input');
        const value = clear ? '' : inputEl?.value;
        const iso = (!clear && value) ? new Date(`${value}T23:59:59`).toISOString() : '';
        try {
            await pb.collection('tournaments').update(tournamentId, { registration_deadline: iso });
            const refreshed = await pb.collection('tournaments').getOne(tournamentId);
            Manage.activeTournament = refreshed;
            if (document.getElementById('screen-manage-names')?.classList.contains('active')) await Manage._renderRosterScreen(refreshed);
            else if (document.getElementById('screen-manage-hub')?.classList.contains('active')) await Manage.openHub(tournamentId);
        } catch (e) {
            Logger.error('saveDeadline failed', { error: e.message });
            if (errEl) {
                errEl.textContent = Auth.isSuperAdmin() ? `Couldn't save: ${e.message}`
                : "Couldn't save — this category's deadline has already passed. Only a super_admin can reopen it.";
                errEl.style.display = 'block';
            }
        }
    },

    _bannerEditor(tournament) {
        const hasImage = !!tournament.banner_image;
        const thumbUrl = hasImage ? pb.files.getURL(tournament, tournament.banner_image, { thumb: '800x300' }) : null;
        return `
        <div style="margin-bottom:0.75rem;padding:6px 10px;background:var(--bg-secondary);border-radius:var(--radius-md);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:8px;">
        ${thumbUrl ? `<img src="${thumbUrl}" alt="" style="width:96px;height:36px;object-fit:cover;border-radius:4px;border:0.5px solid var(--border-light);">`
        : `<span style="font-size:12px;color:var(--text-tertiary);">No banner image set</span>`}
        </div>
        <button class="btn sm ghost" onclick="Manage._toggleBannerEdit()">${hasImage ? 'Change banner' : 'Add banner'}</button>
        </div>
        <div id="banner-edit-row" style="display:none;margin-top:8px;">
        <input type="file" id="banner-edit-input" accept="image/png,image/jpeg,image/webp" class="tournament-name-input" style="margin-bottom:8px;">
        <div style="display:flex;gap:6px;">
        <button class="btn sm primary" style="flex:1;" onclick="Manage.saveBanner('${tournament.id}')">Upload</button>
        ${hasImage ? `<button class="btn sm ghost" onclick="Manage.saveBanner('${tournament.id}', true)">Remove banner</button>` : ''}
        </div>
        <div id="banner-edit-error" style="font-size:11px;color:var(--text-error);margin-top:6px;display:none;"></div>
        </div>
        </div>`;
    },

    _toggleBannerEdit() {
        const row = document.getElementById('banner-edit-row');
        if (row) row.style.display = row.style.display === 'none' ? 'block' : 'none';
    },

    async saveBanner(tournamentId, clear = false) {
        const errEl = document.getElementById('banner-edit-error');
        if (errEl) errEl.style.display = 'none';
        try {
            if (clear) {
                await DB.clearTournamentBanner(tournamentId);
            } else {
                const inputEl = document.getElementById('banner-edit-input');
                const file = inputEl?.files?.[0];
                if (!file) { if (errEl) { errEl.textContent = 'Choose an image first.'; errEl.style.display = 'block'; } return; }
                await DB.uploadTournamentBanner(tournamentId, file);
            }
            const refreshed = await pb.collection('tournaments').getOne(tournamentId);
            Manage.activeTournament = refreshed;
            if (document.getElementById('screen-manage-names')?.classList.contains('active')) await Manage._renderRosterScreen(refreshed);
            else if (document.getElementById('screen-manage-hub')?.classList.contains('active')) await Manage.openHub(tournamentId);
        } catch (e) {
            Logger.error('saveBanner failed', { error: e.message });
            if (errEl) { errEl.textContent = Manage._describeBannerError(e); errEl.style.display = 'block'; }
        }
    },

    _describeBannerError(e) {
        if (e.status === 403) return "You don't have permission to update this tournament right now — if its registration deadline has passed, only a super_admin can edit it.";
        const fieldMsg = e.data?.data?.banner_image?.message;
        if (fieldMsg) return `Image rejected: ${fieldMsg} (max 5MB, JPEG/PNG/WebP only).`;
        return `Couldn't save: ${e.data?.message || e.message}`;
    },

    /* ── HUB SCREEN — admin actions only; viewing links out to public pages ── */

    async openHub(tournamentId) {
        try {
            Manage.activeTournament = await pb.collection('tournaments').getOne(tournamentId);
            Manage.teams = await DB.getTeams(tournamentId);
            Manage.fixtures = await pb.collection('fixtures').getFullList({
                filter: `tournament="${tournamentId}"`, fields: 'id,status,is_bye,round,home_team,away_team', requestKey: null,
            });
            Manage._renderHub();
            UI.showScreen('screen-manage-hub');
        } catch (e) {
            Logger.error('Manage.openHub failed', { error: e.message });
            UI.showError('manage-list-error', 'manage-list-error-msg', `Could not open: ${e.message}`);
        }
    },

    _renderHub() {
        const t = Manage.activeTournament;
        document.getElementById('hub-title').textContent = t.event_name || t.name;
        document.getElementById('hub-meta').textContent = `${Manage.teams.length} teams · ${t.format.replace(/_/g, ' ')}`;
        const badge = document.getElementById('hub-status');
        badge.textContent = Manage._statusLabel(t.status);
        badge.className = `status-badge badge-${t.status}`;

        document.getElementById('hub-deadline').innerHTML = Manage._deadlineEditor(t);
        document.getElementById('hub-banner').innerHTML = Manage._bannerEditor(t);

        const realFx = Manage.fixtures.filter(f => !f.is_bye);
        const done = realFx.filter(f => f.status === 'completed').length;
        const rounds = [...new Set(Manage.fixtures.map(f => f.round))].length;
        document.getElementById('hub-stats-row').innerHTML = `
        <div class="stat-box"><div class="stat-val">${Manage.teams.length}</div><div class="stat-lbl">Teams</div></div>
        <div class="stat-box"><div class="stat-val">${done}/${realFx.length}</div><div class="stat-lbl">Played</div></div>
        <div class="stat-box"><div class="stat-val">${rounds}</div><div class="stat-lbl">Rounds</div></div>`;

        document.getElementById('hub-links').innerHTML = `
        <a class="btn ghost" href="fixtures.html?id=${t.id}" target="_blank">View schedule →</a>
        ${t.format !== 'round_robin' ? `<a class="btn ghost" href="bracket.html?id=${t.id}" target="_blank">View bracket →</a>` : ''}
        ${t.format !== 'elimination' ? `<a class="btn ghost" href="standings.html?id=${t.id}" target="_blank">View standings →</a>` : ''}
        <a class="btn primary" href="scores.html?tournament=${t.id}">⚡ Score this tournament</a>`;

        const regenBtn = document.getElementById('btn-hub-regenerate');
        if (regenBtn) regenBtn.style.display = Manage._hasAnyResult() ? 'none' : '';
        const resultsBtn = document.getElementById('btn-hub-results');
        if (resultsBtn) resultsBtn.style.display = t.status === 'completed' ? '' : 'none';
    },

    _hasAnyResult() { return Manage.fixtures.some(f => !f.is_bye && f.status === 'completed'); },

    async regenerateFixtures() {
        const t = Manage.activeTournament;
        if (Manage._hasAnyResult()) { alert("Can't regenerate — this category already has recorded results."); return; }
        if (!confirm('Delete current fixtures and go back to roster editing? This cannot be undone.')) return;

        const btn = document.getElementById('btn-hub-regenerate');
        if (btn) { btn.disabled = true; btn.textContent = 'Regenerating…'; }
        try {
            await DB.deleteFixturesForTournament(t.id);
            await DB.updateTournament(t.id, { status: 'pending' });
            Manage.activeTournament.status = 'pending';
            await Manage._renderRosterScreen(t);
            UI.showScreen('screen-manage-names');
        } catch (e) {
            Logger.error('regenerateFixtures failed', { error: e.message });
            alert(`Couldn't regenerate: ${e.message}`);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '↺ Regenerate fixtures'; }
        }
    },

    /* ── MANAGE TEAMS MODAL ──────────────────────────────────────────────── */

    async openManageTeamsModal() {
        UI.clearError('manage-teams-error');
        await Manage._renderManageTeamsList();
        document.getElementById('manage-teams-overlay').classList.add('open');
    },
    closeManageTeamsModal() { document.getElementById('manage-teams-overlay').classList.remove('open'); },

    async _renderManageTeamsList() {
        const tournament = Manage.activeTournament;
        const teams = await DB.getTeams(tournament.id);
        Manage.teams = teams;

        document.getElementById('manage-teams-list').innerHTML = teams.map(t => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:0.5px solid var(--border-light);font-size:13px;">
        <span>${escHtml(t.name)}</span>
        <button class="btn sm ghost" onclick="Manage.removeManagedTeam('${t.id}')">Remove</button>
        </div>`).join('') || '<p style="font-size:12px;color:var(--text-tertiary);">No teams on this roster.</p>';

        try {
            const masterTeams = await DB.getMasterTeams();
            const rosterMasterIds = new Set(teams.map(t => t.master_team).filter(Boolean));
            const available = masterTeams.filter(mt => !rosterMasterIds.has(mt.id));
            document.getElementById('manage-teams-add-select').innerHTML = '<option value="">Add a registered team…</option>' +
            available.map(mt => `<option value="${mt.id}">${escHtml(mt.name)}</option>`).join('');
        } catch (e) { Logger.warn('Could not load available teams', { error: e.message }); }
    },

    async addManagedTeam() {
        const select = document.getElementById('manage-teams-add-select');
        const masterTeamId = select?.value;
        if (!masterTeamId) return;
        UI.clearError('manage-teams-error');
        try {
            const masterTeam = Manage.masterTeams?.find(mt => mt.id === masterTeamId) || (await pb.collection('master_teams').getOne(masterTeamId));
            await DB.createTeam(Manage.activeTournament.id, masterTeam.name, Manage.teams.length + 1, null, masterTeamId);
            await Manage._renderManageTeamsList();
        } catch (e) {
            Logger.error('addManagedTeam failed', { error: e.message });
            UI.showError('manage-teams-error', 'manage-teams-error-msg', `Couldn't add team: ${e.message}`);
        }
    },

    async removeManagedTeam(teamId) {
        UI.clearError('manage-teams-error');
        const inFixture = Manage.fixtures.some(f => f.home_team === teamId || f.away_team === teamId);
        if (inFixture) {
            UI.showError('manage-teams-error', 'manage-teams-error-msg',
                         "This team is already in the generated bracket/schedule. Delete and regenerate fixtures instead if this team truly needs to come out.");
            return;
        }
        try {
            await pb.collection('teams').delete(teamId);
            await Manage._renderManageTeamsList();
        } catch (e) {
            Logger.error('removeManagedTeam failed', { error: e.message });
            UI.showError('manage-teams-error', 'manage-teams-error-msg', `Couldn't remove team: ${e.message}`);
        }
    },

    /* ── RESULTS MODAL ───────────────────────────────────────────────────── */

    openResultsModal() { document.getElementById('results-overlay').classList.add('open'); },
    closeResultsModal() { document.getElementById('results-overlay').classList.remove('open'); },

    async _buildResultsData() {
        const tournament = Manage.activeTournament;
        const fixtures = (await pb.collection('fixtures').getFullList({
            filter: `tournament="${tournament.id}"`, sort: 'round,match_number', expand: 'home_team,away_team', requestKey: null,
        })).filter(f => !f.is_bye);

        let standings = [];
        try {
            standings = await pb.collection('team_stats').getFullList({
                filter: `tournament="${tournament.id}"`, sort: 'placement', expand: 'master_team', requestKey: null,
            });
        } catch (e) { Logger.warn('_buildResultsData: standings fetch failed', { error: e.message }); }

        return { tournament, fixtures, standings };
    },

    _triggerDownload(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    async downloadResultsHTML() {
        const { tournament, fixtures, standings } = await Manage._buildResultsData();
        const standingsHtml = standings.length ? `
        <h2>Final Standings</h2>
        <table><tr><th>Place</th><th>Team</th><th>W</th><th>L</th><th>Points For</th><th>Points Against</th></tr>
        ${standings.map(s => `<tr><td>${s.placement || '—'}</td><td>${escHtml(s.expand?.master_team?.name || 'Unknown')}</td>
        <td>${s.wins}</td><td>${s.losses}</td><td>${s.points_for}</td><td>${s.points_against}</td></tr>`).join('')}
        </table>` : '';
        const resultsHtml = `
        <h2>Match Results</h2>
        <table><tr><th>Round</th><th>Home</th><th>Score</th><th>Away</th></tr>
        ${fixtures.map(f => `<tr><td>R${f.round}</td><td>${escHtml(f.expand?.home_team?.name || 'TBD')}</td>
        <td>${f.home_score ?? '–'} – ${f.away_score ?? '–'}</td><td>${escHtml(f.expand?.away_team?.name || 'TBD')}</td></tr>`).join('')}
        </table>`;
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escHtml(tournament.name)} — Results</title>
        <style>body{font-family:-apple-system,sans-serif;padding:2rem;max-width:700px;margin:0 auto;color:#1a1a1a;}
        h1{margin-bottom:4px;}h2{margin-top:2rem;}table{border-collapse:collapse;width:100%;}
        th,td{border:1px solid #ccc;padding:6px 10px;text-align:left;font-size:14px;}th{background:#f2f2f2;}
        .meta{color:#666;margin-bottom:1.5rem;}</style></head><body>
        <h1>${escHtml(tournament.event_name || tournament.name)}</h1>
        <div class="meta">${escHtml(tournament.name)} · ${tournament.format.replace(/_/g, ' ')} · ${fixtures.length} matches</div>
        ${standingsHtml}${resultsHtml}</body></html>`;
        Manage._triggerDownload(html, `${tournament.name.replace(/\s+/g, '_')}_results.html`, 'text/html');
    },

    async downloadResultsCSV() {
        const { tournament, fixtures, standings } = await Manage._buildResultsData();
        const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        let csv = 'Standings\nPlacement,Team,Wins,Losses,Points For,Points Against\n';
        standings.forEach(s => { csv += `${s.placement || ''},${esc(s.expand?.master_team?.name || 'Unknown')},${s.wins},${s.losses},${s.points_for},${s.points_against}\n`; });
        csv += '\nMatch Results\nRound,Home Team,Home Score,Away Team,Away Score\n';
        fixtures.forEach(f => { csv += `${f.round},${esc(f.expand?.home_team?.name || 'TBD')},${f.home_score ?? ''},${esc(f.expand?.away_team?.name || 'TBD')},${f.away_score ?? ''}\n`; });
        Manage._triggerDownload(csv, `${tournament.name.replace(/\s+/g, '_')}_results.csv`, 'text/csv');
    },

    async emailResults() {
        const { tournament, fixtures, standings } = await Manage._buildResultsData();
        const lines = [`${tournament.event_name || tournament.name} — ${tournament.name}`, ''];
        if (standings.length) {
            lines.push('FINAL STANDINGS');
            standings.forEach(s => lines.push(`${s.placement ? s.placement + '.' : '-'} ${s.expand?.master_team?.name || 'Unknown'} — ${s.wins}W ${s.losses}L`));
            lines.push('');
        }
        lines.push('MATCH RESULTS');
        fixtures.forEach(f => lines.push(`R${f.round}: ${f.expand?.home_team?.name || 'TBD'} ${f.home_score ?? '–'} – ${f.away_score ?? '–'} ${f.expand?.away_team?.name || 'TBD'}`));
        const rawBody = lines.join('\n');
        if (rawBody.length > 1500) { alert('Too many results for an email link — use a download option instead.'); return; }
        window.location.href = `mailto:?subject=${encodeURIComponent(`Results — ${tournament.name}`)}&body=${encodeURIComponent(rawBody)}`;
    },

    /* ── ORGANISE EVENTS MODAL ───────────────────────────────────────────── */

    async openOrganiseModal() {
        const overlay = document.getElementById('organise-overlay');
        const list = document.getElementById('organise-list');
        if (!overlay || !list) return;
        overlay.style.display = 'block';
        list.innerHTML = '<div style="color:var(--text-tertiary);font-size:13px;">Loading...</div>';
        try {
            const [tournaments, existingEvents] = await Promise.all([DB.getTournaments(), DB.getEvents()]);
            const datalistHtml = `<datalist id="organise-event-suggestions">${existingEvents.map(e => `<option value="${escHtml(e)}">`).join('')}</datalist>`;
            list.innerHTML = datalistHtml + tournaments.map(t => `
            <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:8px 10px;background:var(--bg-secondary);border-radius:var(--radius-md);border:0.5px solid var(--border-light);">
            <div>
            <div style="font-size:13px;font-weight:500;color:var(--text-primary);">${escHtml(t.name)}
            <span class="status-badge badge-${t.status}" style="margin-left:6px;">${t.status}</span></div>
            <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">${t.format.replace(/_/g, ' ')} · ${new Date(t.created).toLocaleDateString()}</div>
            </div>
            <input type="text" class="organise-event-input" data-tournament-id="${t.id}" value="${escHtml(t.event_name || '')}"
            placeholder="Event name" list="organise-event-suggestions" maxlength="60" style="width:160px;font-size:12px;padding:5px 8px;" />
            </div>`).join('');
        } catch (e) {
            list.innerHTML = `<div style="color:var(--danger);font-size:13px;">Failed to load: ${e.message}</div>`;
        }
    },

    closeOrganiseModal(event) {
        if (event && event.target !== document.getElementById('organise-overlay')) return;
        document.getElementById('organise-overlay').style.display = 'none';
    },

    async saveOrganise() {
        const btn = document.getElementById('btn-save-organise');
        const errEl = document.getElementById('organise-error');
        const inputs = document.querySelectorAll('.organise-event-input');
        errEl.style.display = 'none';
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving...'; }
        try {
            let changeCount = 0;
            for (const input of inputs) {
                const tournamentId = input.dataset.tournamentId;
                const newEvent = input.value.trim() || null;
                const current = await pb.collection('tournaments').getOne(tournamentId, { fields: 'id,event_name' });
                if (newEvent !== (current.event_name || null)) {
                    await pb.collection('tournaments').update(tournamentId, { event_name: newEvent });
                    changeCount++;
                }
            }
            document.getElementById('organise-overlay').style.display = 'none';
            await Manage.loadList();
            UI.showSuccess('manage-list-success', 'manage-list-success-msg', changeCount > 0 ? `${changeCount} tournament(s) updated.` : 'No changes made.');
        } catch (e) {
            errEl.textContent = `Save failed: ${e.message}`;
            errEl.style.display = 'block';
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = 'Save changes'; }
        }
    },

};

document.addEventListener('DOMContentLoaded', () => {
    Manage.init().catch(e => Logger.error('Manage.init failed', { error: e.message }));
});
