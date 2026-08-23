/**
 * =============================================================================
 * app.js — App controller + boot
 *
 * Depends on: config.js, logger.js, auth.js, state.js, generators.js, db.js
 * =============================================================================
 */

const App = {

  /* ── 11a. INITIALISATION ─────────────────────────────────────────────── */

  async init() {
    Logger.info('App.init', { version: CONFIG.VERSION });

    const user = Auth.user();
    Logger.info('Auth state', {
      loggedIn: !!user,
      role    : Auth.role(),
                email   : user?.email ?? '(guest)',
    });

    App._renderAuthBar();

    const online = await DB.healthCheck();
    UI.setConnectionStatus(online);
    if (!online) {
      UI.showError('home-error', 'home-error-msg',
                   'Cannot reach PocketBase. Ensure it is running.');
    }

    App._initSetupScreen();
    /*await migrateExistingTournaments();
     * await migrateHistoricalStats();*/
    await App.loadTournaments();
    App._loadHeroContent(); // stats banner, match snippet, recent champions — non-blocking
    App._initScrollFadeIn();
  },

  // Real numbers only — no placeholder/invented stats. Each query is a
  // cheap getList(1,1,...) just to read totalItems, not a full fetch.
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
        <div class="stats-banner-item"><div class="stat-value">${teamsCount.totalItems}+</div><div class="stat-label">Teams</div></div>
        <div class="stats-banner-item"><div class="stat-value">${categoriesCount.totalItems}</div><div class="stat-label">Categories</div></div>
        <div class="stats-banner-item"><div class="stat-value">${matchesCount.totalItems}</div><div class="stat-label">Matches played</div></div>
        <div class="stats-banner-item"><div class="pulse-badge pulse-live" style="margin-top:2px;"><span class="pulse-dot"></span>Live scores</div></div>
        </div>`;
      }
    } catch (e) {
      Logger.warn('_loadHeroContent stats failed', { error: e.message });
    }

    App._loadHeroMatchSnippet();
    App._loadRecentChampions();
  },

  // Real match data only — the most recently updated fixture that's either
  // completed or belongs to a currently active tournament. No fabricated
  // team names or scores; if nothing qualifies yet, the snippet just
  // doesn't render rather than showing fake data.
  async _loadHeroMatchSnippet() {
    const el = document.getElementById('hero-match-snippet');
    if (!el) return;
    try {
      const recent = await pb.collection('fixtures').getList(1, 1, {
        filter: `status="completed"`,
        sort: '-updated',
        expand: 'home_team,away_team,tournament',
        requestKey: null,
      });
      const fx = recent.items[0];
      if (!fx) return; // no data yet — snippet stays empty, not fabricated

      const home = fx.expand?.home_team?.name || 'Home';
      const away = fx.expand?.away_team?.name || 'Away';
      const catName = fx.expand?.tournament?.name || '';

      el.innerHTML = `
      <span class="pulse-badge pulse-live"><span class="pulse-dot"></span>Final</span>
      <div class="snippet-teams"><span>${escHtml(home)}</span><span class="snippet-score">${fx.home_score}</span></div>
      <div class="snippet-teams"><span>${escHtml(away)}</span><span class="snippet-score">${fx.away_score}</span></div>
      ${catName ? `<div class="snippet-meta">${escHtml(catName)}</div>` : ''}
      `;
    } catch (e) {
      Logger.warn('_loadHeroMatchSnippet failed', { error: e.message });
    }
  },

  // Real placement=1 data from team_stats, computed automatically when a
  // tournament completes (see DB.saveTeamStats). Hidden entirely if no
  // tournament has finished yet — no placeholder trophies.
  async _loadRecentChampions() {
    const section = document.getElementById('recent-champions-section');
    if (!section) return;
    try {
      const champions = await pb.collection('team_stats').getList(1, 3, {
        filter: `placement=1`,
        sort: '-updated',
        expand: 'master_team,tournament',
        requestKey: null,
      });

      if (!champions.items.length) return; // nothing finished yet — stay empty

      section.innerHTML = `
      <div class="champions-section">
      <div class="champions-heading">🏆 Recent champions</div>
      <div class="champions-grid">
      ${champions.items.map(c => {
        const team = c.expand?.master_team?.name || 'Unknown team';
        const cat  = c.expand?.tournament?.name || '';
        return `<div class="champion-card">
        <span class="champion-medal">🥇</span>
        <div>
        <div class="champion-team">${escHtml(team)}</div>
        <div class="champion-meta">${escHtml(cat)}</div>
        </div>
        </div>`;
      }).join('')}
      </div>
      </div>`;
    } catch (e) {
      Logger.warn('_loadRecentChampions failed', { error: e.message });
    }
  },

  // Fade sections in as they scroll into view — pure progressive
  // enhancement; if IntersectionObserver isn't available for some reason,
  // elements just stay at their default (visible) state via CSS fallback.
  _initScrollFadeIn() {
    const targets = document.querySelectorAll('.hero-fade-in');
    if (!targets.length || !('IntersectionObserver' in window)) {
      targets.forEach(t => t.classList.add('fade-in-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('fade-in-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    targets.forEach(t => observer.observe(t));
  },

  /* ── 11b. HOME SCREEN ────────────────────────────────────────────────── */

  async loadTournaments() {
    Logger.info('loadTournaments');
    UI.clearError('home-error');

    const list        = document.getElementById('tournament-list');
    const newBtn      = document.getElementById('btn-new-tournament');
    const organiseBtn = document.getElementById('btn-organise');
    if (newBtn)      newBtn.style.display      = Auth.isAdmin() ? '' : 'none';
    if (organiseBtn) organiseBtn.style.display = Auth.isAdmin() ? '' : 'none';

    if (!list) return;
    list.innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>';

    try {
      const [tournaments, favourites, teamCounts] = await Promise.all([
        DB.getTournaments(),
                                                                      DB.getFavourites(),
                                                                      DB.getAllTeamCounts(),
      ]);

      State.favourites  = favourites;
      State.teamCounts  = teamCounts;
      Logger.info('Tournaments loaded', { count: tournaments.length });

      if (!tournaments.length) {
        list.innerHTML = `<div class="empty-state">
        <span class="empty-icon">🏆</span>
        No tournaments on the board yet.<br>Set one up and let's get the ball rolling.
        </div>`;
        return;
      }

      const events     = {};
      const standalone = [];

      tournaments.forEach(t => {
        const ev = (t.event_name || '').trim();
        if (ev) {
          if (!events[ev]) events[ev] = [];
          events[ev].push(t);
        } else {
          standalone.push(t);
        }
      });

      let html = '';

      // Favourites section for guests and admins
      if (Auth.canFavourite() && State.favourites.length) {
        const favIds = new Set(
          State.favourites.map(f =>
          typeof f.tournament === 'object' ? f.tournament.id : f.tournament
          )
        );
        const favTournaments = tournaments.filter(t => favIds.has(t.id));
        if (favTournaments.length) {
          html += `
          <div style="margin-bottom:10px;">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;
          letter-spacing:0.07em;color:var(--text-tertiary);padding:0 0 6px 0;">
          ⭐ Following
          </div>
          ${favTournaments.map(t => App._renderTournamentItem(t)).join('')}
          </div>`;
        }
      }

      Object.keys(events).sort().forEach(eventName => {
        html += App._renderEventGroup(eventName, events[eventName]);
      });

      if (standalone.length) {
        html += `<div class="tournament-grid">
        ${standalone.map(t => App._renderTournamentCard(t)).join('')}
        </div>`;
      }

      list.innerHTML = html;

    } catch (e) {
      Logger.error('loadTournaments failed', { error: e.message });
      UI.showError('home-error', 'home-error-msg', `Could not load tournaments: ${e.message}`);
      list.innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span>Couldn\'t load tournaments right now — check your connection and try again.</div>';
    }
  },

  _renderEventGroup(eventName, categories) {
    const allDone     = categories.every(c => c.status === 'completed');
    const anyActive   = categories.some(c => c.status === 'active');
    const groupStatus = allDone ? 'completed' : anyActive ? 'active' : 'pending';

    const statusColors = {
      pending  : 'var(--text-tertiary)',
      active   : '#d4860a',
      completed: 'var(--accent)',
    };
    const statusLabels = {
      pending  : 'Not yet started',
      active   : 'Ongoing',
      completed: 'Complete',
    };

    const AGE_ORDER = ['U10','U12','U13','U14','U16','U19','Senior','Open'];
    const ageGroups = [...new Set(categories.map(c => c.age_group).filter(Boolean))]
    .sort((a, b) => AGE_ORDER.indexOf(a) - AGE_ORDER.indexOf(b));

    const mostRecentlyCompleted = categories
    .filter(c => c.status === 'completed')
    .sort((a, b) => new Date(b.updated) - new Date(a.updated))[0];

    const categoryRows = categories.map(t => App._renderTournamentItem(t, true)).join('');

    return `
    <div class="event-group" style="
    background:var(--bg-primary);border:0.5px solid var(--border-light);
    border-radius:var(--radius-lg);margin-bottom:10px;overflow:hidden;">
    <div style="
    display:flex;align-items:center;justify-content:space-between;
    padding:0.85rem 1rem;background:var(--bg-secondary);
    border-bottom:0.5px solid var(--border-light);flex-wrap:wrap;gap:8px;">
    <div style="display:flex;align-items:center;gap:10px;">
    <span style="font-size:16px;">🏆</span>
    <div>
    <div style="font-size:14px;font-weight:600;color:var(--text-primary)">
    ${escHtml(eventName)}
    </div>
    ${ageGroups.length ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">
      ${ageGroups.map(escHtml).join(' · ')}
      </div>` : ''}
      <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">
      <span style="color:${statusColors[groupStatus]}">${statusLabels[groupStatus]}</span>
      ${mostRecentlyCompleted ? ` &nbsp;·&nbsp; ${escHtml([mostRecentlyCompleted.age_group, mostRecentlyCompleted.gender].filter(Boolean).join(' '))} Complete` : ''}
      </div>
      </div>
      </div>
      ${Auth.isAdmin() ? `
        <button class="btn sm primary"
        onclick="App.goToSetupForEvent('${escHtml(eventName).replace(/'/g, "\\'")}')">
        + Add category
        </button>` : ''}
        </div>
        <div style="padding:6px 0;">${categoryRows}</div>
        </div>`;
  },

  _statusLabel(status) {
    return { pending: 'Not yet started', active: 'Ongoing', completed: 'Complete' }[status] || status;
  },

  _renderTournamentCard(t) {
    const formatText = t.format.replace(/_/g, ' ');
    const catParts   = [t.age_group, t.gender].filter(Boolean);
    const catLabel   = catParts.join(' · ');

    const bannerHtml = t.banner_image
    ? `<img class="tournament-card-banner" src="${pb.files.getURL(t, t.banner_image, { thumb: '800x300' })}" alt="">`
    : `<div class="tournament-card-banner tournament-card-banner-placeholder">
    <span>🏀</span>
    ${catLabel ? `<span class="placeholder-cat">${escHtml(catLabel)}</span>` : ''}
    </div>`;

    const registered = State.teamCounts?.[t.id] || 0;
    const max         = t.max_teams || 0;
    const slotHtml    = max ? `
    <div class="slot-counter">
    <div class="slot-counter-bar"><div class="slot-counter-fill" style="width:${Math.min(100, (registered / max) * 100)}%;"></div></div>
    <span class="slot-counter-label">${registered} / ${max} teams</span>
    </div>` : '';

    const favBtn = Auth.canFavourite() ? (() => {
      const fav = State.favourites.find(f =>
      (typeof f.tournament === 'object' ? f.tournament.id : f.tournament) === t.id
      );
      return fav
      ? `<button class="btn sm ghost" title="Unfavourite" onclick="App.toggleFavourite('${t.id}','${fav.id}')">⭐</button>`
      : `<button class="btn sm ghost" title="Follow" onclick="App.toggleFavourite('${t.id}',null)">☆</button>`;
    })() : '';
    const resumeBtn = Auth.isAdmin() && t.status === 'pending'
    ? `<button class="btn sm ghost" onclick="App.resumeSetup('${t.id}')">✎ Resume</button>` : '';
    const deleteBtn = Auth.isSuperAdmin()
    ? `<button class="btn sm danger" onclick="App.deleteTournament('${t.id}','${escHtml(t.name).replace(/'/g, "\\'")}')">Delete</button>` : '';

    return `<div class="tournament-card">
    ${bannerHtml}
    <div class="tournament-card-body">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
    <div style="font-size:14px;font-weight:600;color:var(--text-primary);">${escHtml(t.name)}</div>
    <span class="status-badge badge-${t.status}">${App._statusLabel(t.status)}</span>
    </div>
    ${catLabel ? `<div class="tournament-card-badges">
      ${t.age_group ? `<span class="cat-badge">${escHtml(t.age_group)}</span>` : ''}
      ${t.gender    ? `<span class="cat-badge">${escHtml(t.gender)}</span>`    : ''}
      <span class="cat-badge cat-badge-format">${formatText}</span>
      </div>` : `<div class="tournament-card-badges"><span class="cat-badge cat-badge-format">${formatText}</span></div>`}
      ${App._deadlineBadge(t.registration_deadline)}
      ${slotHtml}
      <div class="tournament-card-actions">
      ${resumeBtn}
      <button class="btn sm primary" onclick="App.openTournament('${t.id}')">Open</button>
      <a class="btn sm ghost" href="bracket.html?id=${t.id}">Bracket</a>
      ${deleteBtn}
      ${favBtn}
      </div>
      </div>
      </div>`;
  },

  _renderTournamentItem(tournament, isCategory = false) {
    const t          = tournament;
    const formatText = t.format.replace(/_/g, ' ');
    const dateText   = new Date(t.created).toLocaleDateString();

    const favBtn = Auth.canFavourite() ? (() => {
      const fav = State.favourites.find(f =>
      (typeof f.tournament === 'object' ? f.tournament.id : f.tournament) === t.id
      );
      return fav
      ? `<button class="btn sm ghost" title="Unfavourite"
      onclick="App.toggleFavourite('${t.id}','${fav.id}')">⭐</button>`
      : `<button class="btn sm ghost" title="Follow"
      onclick="App.toggleFavourite('${t.id}',null)">☆</button>`;
    })() : '';

    const resumeBtn = Auth.isAdmin() && t.status === 'pending' ? `
    <button class="btn sm ghost" onclick="App.resumeSetup('${t.id}')">
    ✎ Resume setup
    </button>` : '';

    const deleteBtn = Auth.isSuperAdmin() ? `
    <button class="btn sm danger"
    onclick="App.deleteTournament('${t.id}','${escHtml(t.name).replace(/'/g, "\\'")}')">
    Delete
    </button>` : '';


    return `
    <div style="
    display:flex;align-items:center;justify-content:space-between;
    padding:${isCategory ? '0.6rem 1rem 0.6rem 2rem' : '0.85rem 1rem'};
    border-bottom:0.5px solid var(--border-light);
    flex-wrap:wrap;gap:8px;transition:background 0.12s;"
    onmouseover="this.style.background='var(--bg-secondary)'"
    onmouseout="this.style.background='transparent'">
    <div>
    <div style="font-size:${isCategory ? '13px' : '14px'};font-weight:500;
    color:var(--text-primary);display:flex;align-items:center;gap:6px;">
    ${isCategory ? '<span style="font-size:11px;color:var(--text-tertiary)">↳</span>' : ''}
    ${escHtml(t.name)}
    </div>
    <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">
    ${formatText} · ${dateText}
    </div>
    ${App._deadlineBadge(t.registration_deadline)}
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
    <span class="status-badge badge-${t.status}">${App._statusLabel(t.status)}</span>
    ${resumeBtn}
    <button class="btn sm primary" onclick="App.openTournament('${t.id}')">Open</button>
    <a class="btn sm ghost" href="bracket.html?id=${t.id}">Bracket</a>
    ${deleteBtn}
    ${favBtn}
    </div>
    </div>`;
  },

  _deadlineBadge(deadline) {
    if (!deadline) return '';
    const isLocked = new Date(deadline) < new Date();
    const dateStr  = new Date(deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return isLocked
    ? `<div style="font-size:11px;color:var(--text-warning);margin-top:2px;">🔒 Locked since ${dateStr}</div>`
    : `<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">Registration closes ${dateStr}</div>`;
  },

  _renderAuthBar() {
    const ctrl = document.getElementById('auth-controls');
    const navUsers = document.getElementById('nav-users');
    if (navUsers) navUsers.style.display = Auth.isAdmin() ? '' : 'none';
    const navCourts = document.getElementById('nav-courts');
    if (navCourts) navCourts.style.display = Auth.isAdmin() ? '' : 'none';

    const heroCta = document.getElementById('hero-cta-secondary');
    if (heroCta) heroCta.style.display = Auth.user() ? 'none' : '';

    if (!ctrl) return;
    const user = Auth.user();

    if (user) {
      const roleLabel = {
        super_admin      : '⚡ Super Admin',
        tournament_admin : '✏️ Tournament Admin',
        score_inputter   : '🖊️ Score Inputter',
        fan              : '⭐ Fan',
      }[user.role] || user.role;

      const displayName = escHtml(user.name || user.email);

      ctrl.innerHTML = `
      <span style="font-size:12px;color:var(--text-secondary);">
      ${displayName}
      <span style="margin-left:6px;font-size:10px;padding:2px 6px;
      border-radius:4px;background:var(--bg-secondary);
      color:var(--text-tertiary);border:0.5px solid var(--border-light);">
      ${roleLabel}
      </span>
      </span>
      <button class="btn sm ghost" onclick="Auth.logout()">Sign out</button>`;
    } else {
      ctrl.innerHTML = `
      <span style="font-size:12px;color:var(--text-tertiary);">Browsing as guest</span>
      <a href="login.html" class="btn sm primary">Sign in / Register</a>`;
    }

    const bottomAuthItem = document.getElementById('bottom-nav-auth');
    if (bottomAuthItem) {
      if (user) {
        bottomAuthItem.innerHTML = `<span class="nav-icon">👤</span>${escHtml(user.name?.split(' ')[0] || 'Account')}`;
        bottomAuthItem.href      = '#';
        bottomAuthItem.onclick   = (e) => {
          e.preventDefault();
          App._showAccountSheet();
        };
      } else {
        bottomAuthItem.innerHTML = `<span class="nav-icon">👤</span>Sign in`;
        bottomAuthItem.href      = 'login.html';
        bottomAuthItem.onclick   = null;
      }
    }
  },

  // ── Roster/format grid — SINGLE definition. A duplicate of this method
  // previously existed further down the file (old pre-manual-pools version
  // referencing the retired #roster-pool-size-input field). That duplicate
  // silently won at object-construction time and broke pool assignment
  // entirely, since it never touched #roster-pool-assignment-wrap. Removed.
  _renderRosterFormatGrid(tournamentId, current, teamCount) {
    const gridEl    = document.getElementById('roster-format-grid');
    if (!gridEl) return;
    const suggested = teamCount ? suggestFormat(teamCount) : null;

    gridEl.innerHTML = FORMATS.map(f => {
      const isSel = f.id === current;
      return `<button type="button" class="btn sm ${isSel ? 'primary' : 'ghost'}"
      onclick="App.setRosterFormat('${tournamentId}', '${f.id}')">
      ${f.icon} ${f.name}${f.id === suggested ? ' ★' : ''}
      </button>`;
    }).join('');

    const poolRow    = document.getElementById('roster-pool-size-row');
    const poolInput  = document.getElementById('roster-pool-count-input');
    const assignWrap = document.getElementById('roster-pool-assignment-wrap');
    const isGroupStage = current === 'group_stage';

    if (poolRow) poolRow.style.display = isGroupStage ? 'block' : 'none';
    if (assignWrap) assignWrap.style.display = isGroupStage ? 'block' : 'none';

    if (isGroupStage) {
      const poolCount = State._manualPoolCount || 2;
      if (poolInput) poolInput.value = poolCount;
      App._renderPoolAssignmentUI(tournamentId, poolCount);
    }

    App._renderFormatPreview(current);
  },

  // Renders one dropdown per roster team, letting the admin assign a pool
  // letter manually. Reads/writes teams.group_name directly — no schema
  // change. Teams left on "Unassigned" fall back to automatic distribution
  // in buildManualGroups (generators.js) at generation/preview time.
  _renderPoolAssignmentUI(tournamentId, poolCountRaw) {
    const poolCount = Math.max(2, Math.min(8, parseInt(poolCountRaw, 10) || 2));
    State._manualPoolCount = poolCount;

    const wrap = document.getElementById('roster-pool-assignment-wrap');
    if (!wrap) return;

    const teams = State.teams || [];
    if (teams.length < 2) {
      wrap.innerHTML = `<p style="font-size:12px;color:var(--text-tertiary);font-style:italic;">
      Add at least 2 teams before assigning pools.
      </p>`;
      return;
    }

    const letters = 'ABCDEFGH'.slice(0, poolCount).split('');
    const poolCounts = {};
    letters.forEach(l => poolCounts[l] = 0);
    teams.forEach(t => { if (t.group_name && poolCounts[t.group_name] !== undefined) poolCounts[t.group_name]++; });

    const countsLine = letters.map(l => `Pool ${l}: ${poolCounts[l]}`).join(' · ');

    wrap.innerHTML = `
    <div style="font-size:13px;font-weight:600;margin-bottom:6px;">Pool assignment</div>
    <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:8px;">
    ${countsLine} — leave "Unassigned" to auto-distribute those teams when fixtures are generated.
    </div>
    <div style="max-height:260px;overflow-y:auto;border:0.5px solid var(--border-light);border-radius:var(--radius-md);padding:8px;">
    ${teams.map(t => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:0.5px solid var(--border-light);font-size:13px;gap:8px;">
      <span style="flex:1;">${escHtml(t.name)}</span>
      <select class="tournament-name-input" style="margin-bottom:0;width:140px;"
      onchange="App.savePoolAssignment('${t.id}', this.value)">
      <option value="">Unassigned</option>
      ${letters.map(l => `<option value="${l}" ${t.group_name === l ? 'selected' : ''}>Pool ${l}</option>`).join('')}
      </select>
      </div>
      `).join('')}
      </div>
      `;
  },

  async savePoolAssignment(teamId, poolLetter) {
    try {
      await pb.collection('teams').update(teamId, { group_name: poolLetter || null });
      const t = State.teams.find(t => t.id === teamId);
      if (t) t.group_name = poolLetter || null;
      App._renderPoolAssignmentUI(State.activeTournament.id, State._manualPoolCount || 2);
      App._renderFormatPreview('group_stage'); // preview reflects the reassignment immediately
    } catch (e) {
      Logger.error('savePoolAssignment failed', { error: e.message });
      alert(`Couldn't save pool assignment: ${e.message}`);
    }
  },

  _showAccountSheet() {
    document.getElementById('_acct-sheet')?.remove();

    const user      = Auth.user();
    const roleLabel = { super_admin: '⚡ Super Admin', tournament_admin: '✏️ Admin', score_inputter: '🖊️ Score Inputter', fan: '⭐ Fan' }[user?.role] || '';

    const sheet = document.createElement('div');
    sheet.id    = '_acct-sheet';
    sheet.innerHTML = `
    <div id="_acct-backdrop" style="position:fixed;inset:0;z-index:299;background:rgba(0,0,0,0.4);"
    onclick="document.getElementById('_acct-sheet').remove()"></div>
    <div style="position:fixed;bottom:60px;left:0;right:0;z-index:300;
    background:var(--bg-primary);border-top:0.5px solid var(--border-light);
    border-radius:var(--radius-lg) var(--radius-lg) 0 0;
    padding:1.25rem 1.5rem 1.5rem;max-width:480px;margin:0 auto;">
    <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">
    ${escHtml(user?.name || user?.email || '')}
    </div>
    <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:1.25rem;">
    ${escHtml(user?.email || '')}
    ${roleLabel ? `<span style="margin-left:8px;padding:2px 6px;border-radius:4px;
      background:var(--bg-secondary);border:0.5px solid var(--border-light);">
      ${roleLabel}</span>` : ''}
      </div>
      <button onclick="Auth.logout()" class="btn sm ghost"
      style="width:100%;justify-content:center;color:var(--danger);
      border-color:var(--danger);">
      Sign out
      </button>
      </div>`;
      document.body.appendChild(sheet);
  },

  async toggleFavourite(tournamentId, existingFavouriteId) {
    try {
      if (existingFavouriteId) {
        await DB.removeFavourite(existingFavouriteId);
        Logger.info('Removed favourite', { tournamentId });
      } else {
        await DB.addFavourite(tournamentId);
        Logger.info('Added favourite', { tournamentId });
      }
      await App.loadTournaments();
    } catch (e) {
      Logger.error('toggleFavourite failed', { error: e.message });
    }
  },

  async openTournament(tournamentId) {
    Logger.info('openTournament', { tournamentId });
    try {
      State.activeTournament = await pb.collection('tournaments').getOne(tournamentId);
      State.teams            = await DB.getTeams(tournamentId);
      State.fixtures         = await DB.getFixtures(tournamentId);
      App._renderFixturesScreen();
      UI.showScreen('screen-fixtures');
      const link = document.getElementById('bracket-page-link');
      if (link) link.href = `bracket.html?id=${tournamentId}`;
    } catch (e) {
      Logger.error('openTournament failed', { error: e.message });
      UI.showError('home-error', 'home-error-msg', `Could not open: ${e.message}`);
    }
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
      Logger.info('deleteTournament: cleaned orphan-prone records', { stats: stats.length, favourites: favs.length });

      await DB.deleteTournament(id);
      await App.loadTournaments();
    } catch (e) {
      Logger.error('deleteTournament failed', { error: e.message });
      UI.showError('home-error', 'home-error-msg', `Delete failed: ${e.message}`);
    }
  },

  goToHome() {
    UI.showScreen('screen-home');
    App.loadTournaments();
  },


  /* ── 11c. SETUP SCREEN ───────────────────────────────────────────────── */

  goToSetup() {
    State.setupData = {
      eventName: null, eventSeries: null, eventEdition: null,
      name: '', names: [], masterRefs: [],
    };

    const el = id => document.getElementById(id);
    if (el('event-series'))             el('event-series').value           = '';
    if (el('event-edition'))            el('event-edition').value          = '';
    if (el('registration-deadline'))    el('registration-deadline').value  = '';
    if (el('tournament-banner'))        el('tournament-banner').value      = '';
    if (el('tournament-name-preview'))  el('tournament-name-preview').textContent = '';
    if (el('event-series'))  { el('event-series').readOnly  = false; el('event-series').style.opacity  = ''; el('event-series').style.background  = ''; }
    if (el('event-edition')) { el('event-edition').readOnly = false; el('event-edition').style.opacity = ''; el('event-edition').style.background = ''; }

    const list = el('categories-list');
    if (list) list.innerHTML = '';
    App._categoryRowCounter = 0;
    App.addCategoryRow();

    App._populateEventSuggestions();
    UI.showScreen('screen-setup');
  },

  goToSetupForEvent(eventName) {
    Logger.info('goToSetupForEvent', { eventName });

    const match   = eventName.match(/^(.+?)\s+([\d][^\s]*)$/);
    const series  = match ? match[1].trim() : eventName;
    const edition = match ? match[2].trim() : '';

    State.setupData = {
      eventName, eventSeries: series, eventEdition: edition || null,
      name: '', names: [], masterRefs: [],
    };

    const el = id => document.getElementById(id);

    const seriesEl = el('event-series');
    if (seriesEl) {
      seriesEl.value    = series;
      seriesEl.readOnly = true;
      seriesEl.style.opacity    = '0.7';
      seriesEl.style.background = 'var(--bg-tertiary)';
      seriesEl.title    = `Part of "${eventName}" — series locked`;
    }

    const editionEl = el('event-edition');
    if (editionEl) {
      editionEl.value    = edition;
      editionEl.readOnly = false;
      editionEl.style.opacity    = '';
      editionEl.style.background = '';
    }

    if (el('registration-deadline')) el('registration-deadline').value = '';
    if (el('tournament-banner'))     el('tournament-banner').value     = '';

    if (el('tournament-name-preview'))
      el('tournament-name-preview').textContent = `Adding category to: "${eventName}"`;

    const list = el('categories-list');
    if (list) list.innerHTML = '';
    App._categoryRowCounter = 0;
    App.addCategoryRow();

    App._populateEventSuggestions();
    UI.showScreen('screen-setup');
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
      const all = await pb.collection('tournaments').getFullList({
        fields: 'event_series,event_name', requestKey: null,
      });
      const series = [...new Set(
        all.map(t => t.event_series || t.event_name?.match(/^(.+?)\s+[\d]/)?.[1] || t.event_name)
        .filter(Boolean)
      )].sort();
      datalist.innerHTML = series.map(s => `<option value="${escHtml(s)}">`).join('');
    } catch (e) {
      Logger.warn('_populateEventSuggestions failed', { error: e.message });
    }
  },

  /* ── 11c.1 MULTI-CATEGORY BUILDER ON SETUP SCREEN ────────────────────── */

  _categoryRowCounter: 0,

  addCategoryRow(prefill = null) {
    const rowId = `cat-row-${App._categoryRowCounter++}`;
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
    <option value="U10">U10</option>
    <option value="U12">U12</option>
    <option value="U13">U13</option>
    <option value="U14">U14</option>
    <option value="U16">U16</option>
    <option value="U19">U19</option>
    <option value="Senior">Senior</option>
    <option value="Open">Open</option>
    </select>
    <button type="button" class="btn sm ghost" onclick="App.removeCategoryRow('${rowId}')" title="Remove category">✕</button>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;">
    ${GENDERS.map(g => `
      <label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;">
      <input type="checkbox" class="cat-gender-check" value="${g}" ${checked.includes(g) ? 'checked' : ''} style="width:16px;height:16px;">
      ${g}
      </label>
      `).join('')}
      </div>
      `;
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

  /* ── 11c.2 RESUME SETUP SCREEN ────────────────────────────────────────── */

  async resumeSetup(tournamentId) {
    Logger.info('App.resumeSetup (manage roster)', { tournamentId });

    const btn = event?.target;
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

    try {
      const [tournament, existingFixtures] = await Promise.all([
        pb.collection('tournaments').getOne(tournamentId),
                                                               DB.getFixtures(tournamentId),
      ]);

      if (existingFixtures.length > 0) {
        State.activeTournament = tournament;
        State.teams            = await DB.getTeams(tournamentId);
        State.fixtures         = existingFixtures;
        App._renderFixturesScreen();
        UI.showScreen('screen-fixtures');
        return;
      }

      await App._renderRosterScreen(tournament);
      UI.showScreen('screen-names');

    } catch (e) {
      Logger.error('resumeSetup failed', { error: e.message });
      UI.showError('home-error', 'home-error-msg', `Couldn't open: ${e.message}`);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '✎ Resume'; }
    }
  },

  // Deadline display + edit control. Reduced padding per your request —
  // this was measurably the biggest single contributor to the "wasted
  // vertical space" complaint, since it used to render at 10px/12px
  // padding with just one line of text inside it.
  _deadlineEditor(tournament) {
    if (!Auth.isAdmin()) return '';

    const deadline = tournament.registration_deadline;
    const isLocked = deadline && new Date(deadline) < new Date();
    const dateStr  = deadline
    ? new Date(deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
    const inputVal = deadline ? new Date(deadline).toISOString().slice(0, 10) : '';

    const statusLine = deadline
    ? (isLocked
    ? `<span style="color:var(--text-warning);">🔒 Locked since ${dateStr}</span>`
    : `<span style="color:var(--text-tertiary);">Registration closes ${dateStr}</span>`)
    : `<span style="color:var(--text-tertiary);">No deadline set</span>`;

    return `
    <div style="margin-bottom:0.75rem;padding:6px 10px;background:var(--bg-secondary);border-radius:var(--radius-md);">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
    <div style="font-size:12px;">${statusLine}</div>
    <button class="btn sm ghost" onclick="App._toggleDeadlineEdit()">Edit deadline</button>
    </div>
    <div id="deadline-edit-row" style="display:none;margin-top:8px;gap:6px;">
    <input type="date" id="deadline-edit-input" value="${inputVal}" class="tournament-name-input" style="margin-bottom:6px;">
    <div style="display:flex;gap:6px;">
    <button class="btn sm primary" style="flex:1;" onclick="App.saveDeadline('${tournament.id}')">Save</button>
    <button class="btn sm ghost" onclick="App.saveDeadline('${tournament.id}', true)">Clear deadline</button>
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
      Logger.info('saveDeadline', { tournamentId, iso });

      const refreshed = await pb.collection('tournaments').getOne(tournamentId);
      State.activeTournament = refreshed;
      if (document.getElementById('screen-names')?.classList.contains('active')) {
        await App._renderRosterScreen(refreshed);
      } else if (State.fixtures?.length) {
        await App._renderManageTeamsList();
        App._renderFixturesScreen();
      }
    } catch (e) {
      Logger.error('saveDeadline failed', { error: e.message });
      if (errEl) {
        errEl.textContent = Auth.isSuperAdmin()
        ? `Couldn't save: ${e.message}`
        : "Couldn't save — this category's deadline has already passed. Only a super_admin can reopen it.";
        errEl.style.display = 'block';
      }
    }
  },

  // Roster/format/pool-assignment/preview screen. Layout order:
  //   Row 1: deadline editor (left) | Format picker + pool count (right)
  //   Row 2: pool assignment (left) | matchup preview (right)
  //   Then: roster list, then add-team picker — both full width below.
  async _renderRosterScreen(tournament) {
    State.activeTournament = tournament;
    const [teams, masterTeams] = await Promise.all([
      DB.getTeams(tournament.id),
                                                   DB.getMasterTeams(),
    ]);
    State.teams       = teams;
    State.masterTeams = masterTeams;

    const progressEl = document.getElementById('category-progress');
    if (progressEl) progressEl.textContent = '';

    const rosterIds  = new Set(teams.map(t => t.expand?.master_team?.id).filter(Boolean));
    const available   = masterTeams.filter(mt => !rosterIds.has(mt.id));
    const n           = teams.length;
    const suggested   = suggestFormat(n || 8);
    const format      = tournament.format || suggested;

    const grid = document.getElementById('team-inputs');
    if (!grid) return;

    grid.innerHTML = `
    <div class="pool-assignment-row" style="margin-bottom:1.5rem;">
    <div>${App._deadlineEditor(tournament)}</div>
    <div>
    <div style="font-size:13px;font-weight:600;margin-bottom:8px;">Format</div>
    <div id="roster-format-grid" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;"></div>
    <div id="roster-pool-size-row" style="display:none;margin-bottom:10px;">
    <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px;">
    Number of pools
    </label>
    <input type="number" id="roster-pool-count-input" min="2" max="8" value="2"
    class="tournament-name-input" style="margin-bottom:8px;max-width:100px;"
    onchange="App._renderPoolAssignmentUI('${tournament.id}', this.value)">
    </div>
    </div>
    </div>

    <div class="pool-assignment-row">
    <div id="roster-pool-assignment-wrap" style="display:none;">
    </div>
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
      <button class="btn sm ghost" onclick="App.removeRosterTeam('${t.id}', '${tournament.id}')">Remove</button>
      </div>
      `).join('') : '<p style="font-size:12px;color:var(--text-tertiary);">No teams yet — add them as they register below.</p>'}
      </div>

      <div style="margin-bottom:1rem;">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">Add a registered team</div>
      ${available.length ? `
        <select id="roster-add-select" class="tournament-name-input" style="margin-bottom:6px;">
        <option value="">Select a team…</option>
        ${available.map(mt => `<option value="${mt.id}">${escHtml(mt.name)}</option>`).join('')}
        </select>
        <button class="btn primary" style="width:100%;" onclick="App.addRosterTeam('${tournament.id}')">+ Add to roster</button>
        ` : `<p style="font-size:12px;color:var(--text-tertiary);">
        Every registered team is already on this roster.
        <a href="teams.html" style="color:var(--accent);">Register another team</a>
        </p>`}
        </div>
        `;

        App._renderRosterFormatGrid(tournament.id, format, n);
  },

  // Live preview of what a format would actually produce, given whoever's
  // currently on the roster AND their manual pool assignments (if any) —
  // uses the same buildManualGroups/genGroupStageFromGroups pipeline that
  // generateFixturesForRoster uses, so this preview can never lie about
  // what generation will actually produce.
  _renderFormatPreview(formatId) {
    const previewEl = document.getElementById('roster-format-preview');
    if (!previewEl) return;

    const teams = State.teams || [];
    if (teams.length < 2) {
      previewEl.innerHTML = `<p style="font-size:12px;color:var(--text-tertiary);font-style:italic;">
      Add at least 2 teams to see a preview.
      </p>`;
      return;
    }

    let generated;
    if      (formatId === 'round_robin') generated = genRoundRobin(teams.map(t => t.name));
    else if (formatId === 'elimination') generated = genElimination(teams.map(t => t.name));
    else {
      const poolCount = State._manualPoolCount || 2;
      const groups = buildManualGroups(teams, poolCount);
      generated = genGroupStageFromGroups(groups);
    }

    const matchRow = (m) => `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;">
    <span>${escHtml(m.a)}</span>
    <span style="color:var(--text-tertiary);">vs</span>
    <span>${escHtml(m.b)}</span>
    </div>`;

    const roundBlock = (round) => `<div style="margin-bottom:8px;">
    <div style="font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.03em;margin-bottom:2px;">
    ${escHtml(round.label)}
    </div>
    ${round.matches.filter(m => !m.isBye).map(matchRow).join('') || '<div style="font-size:12px;color:var(--text-tertiary);">Bye</div>'}
    </div>`;

    let bodyHtml;
    if (generated.type === 'group_stage') {
      bodyHtml = generated.groupFixtures.map(g => `
      <div style="margin-bottom:10px;">
      <div style="font-size:12px;font-weight:600;margin-bottom:4px;">${escHtml(g.name)} (${g.teams.length} teams)</div>
      ${g.rounds.map(roundBlock).join('')}
      </div>
      `).join('') + `<p style="font-size:11px;color:var(--text-tertiary);font-style:italic;margin-top:6px;">
      Then: top 2 from each group advance to a ${generated.knockout.rounds.length}-round knockout stage.
      </p>`;
    } else {
      bodyHtml = generated.rounds.map(roundBlock).join('');
    }

    previewEl.innerHTML = `
    <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">
    Preview with the current ${teams.length} team${teams.length === 1 ? '' : 's'} — ${generated.totalMatches} matches total.
    Nothing here is saved; this updates as you add teams, switch formats, or reassign pools.
    </div>
    <div style="max-height:280px;overflow-y:auto;border:0.5px solid var(--border-light);border-radius:var(--radius-md);padding:10px;">
    ${bodyHtml}
    </div>`;
  },

  async setRosterFormat(tournamentId, formatId) {
    try {
      await DB.updateTournament(tournamentId, { format: formatId });
      State.activeTournament.format = formatId;
      App._renderRosterFormatGrid(tournamentId, formatId, State.teams.length);
    } catch (e) {
      Logger.error('setRosterFormat failed', { error: e.message });
      alert(`Couldn't update format: ${e.message}`);
    }
  },

  async addRosterTeam(tournamentId) {
    const select = document.getElementById('roster-add-select');
    const masterTeamId = select?.value;
    if (!masterTeamId) return;
    const masterTeam = State.masterTeams.find(mt => mt.id === masterTeamId);
    if (!masterTeam) return;

    try {
      await DB.createTeam(tournamentId, masterTeam.name, State.teams.length + 1, null, masterTeam.id);
      Logger.info('addRosterTeam', { tournamentId, team: masterTeam.name });
      await App._renderRosterScreen(State.activeTournament);
    } catch (e) {
      Logger.error('addRosterTeam failed', { error: e.message });
      alert(`Couldn't add team: ${e.message}`);
    }
  },

  async removeRosterTeam(teamId, tournamentId) {
    try {
      await pb.collection('teams').delete(teamId);
      Logger.info('removeRosterTeam', { teamId });
      await App._renderRosterScreen(State.activeTournament);
    } catch (e) {
      Logger.error('removeRosterTeam failed', { error: e.message });
      alert(`Couldn't remove team: ${e.message}`);
    }
  },

  // The actual bracket-generation step. Round robin / elimination: simple
  // name-list generators, unchanged. Group stage: reads whatever manual
  // pool assignments exist on teams.group_name via buildManualGroups
  // (unassigned teams auto-distributed to whichever pool has fewest
  // members), persists the FINAL resolved group_name back onto every team
  // (including auto-placed ones, so the roster screen's dropdowns always
  // reflect what actually got generated), then builds fixtures from that.
  async generateFixturesForRoster() {
    const tournament = State.activeTournament;
    const teams = State.teams || [];
    if (teams.length < 3) {
      alert('Add at least 3 teams before generating fixtures.');
      return;
    }

    const btn = document.getElementById('btn-generate-roster');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }

    try {
      const format = tournament.format || suggestFormat(teams.length);
      let generated;

      if (format === 'group_stage') {
        const poolCount = State._manualPoolCount
        || new Set(teams.map(t => t.group_name).filter(Boolean)).size
        || 2;
        const groups = buildManualGroups(teams, poolCount);

        const finalGroupOf = {};
        groups.forEach(g => {
          const letter = g.name.replace('Group ', '');
          g.teams.forEach(name => { finalGroupOf[name] = letter; });
        });
        for (const t of teams) {
          const finalGroup = finalGroupOf[t.name] || null;
          if (finalGroup && t.group_name !== finalGroup) {
            await pb.collection('teams').update(t.id, { group_name: finalGroup });
          }
        }

        generated = genGroupStageFromGroups(groups);
      } else if (format === 'elimination') {
        generated = genElimination(teams.map(t => t.name));
      } else {
        generated = genRoundRobin(teams.map(t => t.name));
      }

      const teamMap = {};
      teams.forEach(t => { teamMap[t.name] = t.id; });

      await App._persistFixtures(tournament.id, generated, teamMap);
      await DB.updateTournament(tournament.id, { status: 'active' });

      State.activeTournament.status = 'active';
      State.fixtures = await DB.getFixtures(tournament.id);
      App._renderFixturesScreen();
      UI.showScreen('screen-fixtures');
      UI.showSuccess('fixtures-success', 'fixtures-success-msg',
                     `"${tournament.name}" — ${generated.totalMatches} matches generated.`);

    } catch (e) {
      Logger.error('generateFixturesForRoster failed', { error: e.message });
      alert(`Couldn't generate fixtures: ${e.message}`);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Generate fixtures →'; }
    }
  },

  openResultsModal() {
    document.getElementById('results-overlay').classList.add('open');
  },

  closeResultsModal() {
    document.getElementById('results-overlay').classList.remove('open');
  },

  async _buildResultsData() {
    const tournament = State.activeTournament;
    const fixtures = (State.fixtures || [])
    .filter(f => !f.is_bye)
    .sort((a, b) => a.round - b.round || (a.match_number ?? 0) - (b.match_number ?? 0));

    let standings = [];
    try {
      standings = await pb.collection('team_stats').getFullList({
        filter: `tournament="${tournament.id}"`,
        sort: 'placement',
        expand: 'master_team',
        requestKey: null,
      });
    } catch (e) {
      Logger.warn('_buildResultsData: standings fetch failed', { error: e.message });
    }

    return { tournament, fixtures, standings };
  },

  _triggerDownload(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  async downloadResultsHTML() {
    const { tournament, fixtures, standings } = await App._buildResultsData();

    const standingsHtml = standings.length ? `
    <h2>Final Standings</h2>
    <table>
    <tr><th>Place</th><th>Team</th><th>W</th><th>L</th><th>Points For</th><th>Points Against</th></tr>
    ${standings.map(s => `<tr>
      <td>${s.placement || '—'}</td>
      <td>${escHtml(s.expand?.master_team?.name || 'Unknown')}</td>
      <td>${s.wins}</td><td>${s.losses}</td>
      <td>${s.points_for}</td><td>${s.points_against}</td>
      </tr>`).join('')}
      </table>` : '';

      const resultsHtml = `
      <h2>Match Results</h2>
      <table>
      <tr><th>Round</th><th>Home</th><th>Score</th><th>Away</th></tr>
      ${fixtures.map(f => `<tr>
        <td>R${f.round}</td>
        <td>${escHtml(f.expand?.home_team?.name || 'TBD')}</td>
        <td>${f.home_score ?? '–'} – ${f.away_score ?? '–'}</td>
        <td>${escHtml(f.expand?.away_team?.name || 'TBD')}</td>
        </tr>`).join('')}
        </table>`;

        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
        <title>${escHtml(tournament.name)} — Results</title>
        <style>
        body { font-family: -apple-system, sans-serif; padding: 2rem; max-width: 700px; margin: 0 auto; color: #1a1a1a; }
        h1 { margin-bottom: 4px; } h2 { margin-top: 2rem; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; font-size: 14px; }
        th { background: #f2f2f2; }
        .meta { color: #666; margin-bottom: 1.5rem; }
        </style>
        </head><body>
        <h1>${escHtml(tournament.event_name || tournament.name)}</h1>
        <div class="meta">${escHtml(tournament.name)} · ${tournament.format.replace(/_/g, ' ')} · ${fixtures.length} matches</div>
        ${standingsHtml}
        ${resultsHtml}
        </body></html>`;

        App._triggerDownload(html, `${tournament.name.replace(/\s+/g, '_')}_results.html`, 'text/html');
  },

  async downloadResultsCSV() {
    const { tournament, fixtures, standings } = await App._buildResultsData();
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

    let csv = 'Standings\n';
    csv += 'Placement,Team,Wins,Losses,Points For,Points Against\n';
    standings.forEach(s => {
      csv += `${s.placement || ''},${esc(s.expand?.master_team?.name || 'Unknown')},${s.wins},${s.losses},${s.points_for},${s.points_against}\n`;
    });

    csv += '\nMatch Results\n';
    csv += 'Round,Home Team,Home Score,Away Team,Away Score\n';
    fixtures.forEach(f => {
      csv += `${f.round},${esc(f.expand?.home_team?.name || 'TBD')},${f.home_score ?? ''},${esc(f.expand?.away_team?.name || 'TBD')},${f.away_score ?? ''}\n`;
    });

    App._triggerDownload(csv, `${tournament.name.replace(/\s+/g, '_')}_results.csv`, 'text/csv');
  },

  async emailResults() {
    const { tournament, fixtures, standings } = await App._buildResultsData();
    const lines = [`${tournament.event_name || tournament.name} — ${tournament.name}`, ''];

    if (standings.length) {
      lines.push('FINAL STANDINGS');
      standings.forEach(s => {
        const place = s.placement ? `${s.placement}.` : '-';
        lines.push(`${place} ${s.expand?.master_team?.name || 'Unknown'} — ${s.wins}W ${s.losses}L`);
      });
      lines.push('');
    }

    lines.push('MATCH RESULTS');
    fixtures.forEach(f => {
      const home = f.expand?.home_team?.name || 'TBD';
      const away = f.expand?.away_team?.name || 'TBD';
      lines.push(`R${f.round}: ${home} ${f.home_score ?? '–'} – ${f.away_score ?? '–'} ${away}`);
    });

    const rawBody = lines.join('\n');
    if (rawBody.length > 1500) {
      alert("This category has too many results to fit in an email link. Please use one of the download options instead and attach it to your email manually.");
      return;
    }

    window.location.href = `mailto:?subject=${encodeURIComponent(`Results — ${tournament.name}`)}&body=${encodeURIComponent(rawBody)}`;
  },

  async openManageTeamsModal() {
    UI.clearError('manage-teams-error');
    await App._renderManageTeamsList();
    document.getElementById('manage-teams-overlay').classList.add('open');
  },

  closeManageTeamsModal() {
    document.getElementById('manage-teams-overlay').classList.remove('open');
  },

  async _renderManageTeamsList() {
    const tournament = State.activeTournament;
    const teams = await DB.getTeams(tournament.id);
    State.teams = teams;

    const deadlineEl = document.getElementById('manage-teams-deadline');
    if (deadlineEl) deadlineEl.innerHTML = App._deadlineEditor(tournament);

    const listEl = document.getElementById('manage-teams-list');
    listEl.innerHTML = teams.map(t => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:0.5px solid var(--border-light);font-size:13px;">
    <span>${escHtml(t.name)}</span>
    <button class="btn sm ghost" onclick="App.removeManagedTeam('${t.id}')">Remove</button>
    </div>
    `).join('') || '<p style="font-size:12px;color:var(--text-tertiary);">No teams on this roster.</p>';

    try {
      const masterTeams = await DB.getMasterTeams();
      const rosterMasterIds = new Set(teams.map(t => t.master_team).filter(Boolean));
      const available = masterTeams.filter(mt => !rosterMasterIds.has(mt.id));
      const selectEl = document.getElementById('manage-teams-add-select');
      selectEl.innerHTML = '<option value="">Add a registered team…</option>' +
      available.map(mt => `<option value="${mt.id}">${escHtml(mt.name)}</option>`).join('');
    } catch (e) {
      Logger.warn('Could not load available teams for manage-teams modal', { error: e.message });
    }
  },

  async addManagedTeam() {
    const select = document.getElementById('manage-teams-add-select');
    const masterTeamId = select?.value;
    if (!masterTeamId) return;

    UI.clearError('manage-teams-error');
    try {
      const masterTeam = State.masterTeams?.find(mt => mt.id === masterTeamId)
      || (await pb.collection('master_teams').getOne(masterTeamId));
      await DB.createTeam(State.activeTournament.id, masterTeam.name, State.teams.length + 1, null, masterTeamId);
      Logger.info('addManagedTeam', { tournament: State.activeTournament.id, team: masterTeam.name });
      await App._renderManageTeamsList();
    } catch (e) {
      Logger.error('addManagedTeam failed', { error: e.message });
      UI.showError('manage-teams-error', 'manage-teams-error-msg',
                   `Couldn't add team: ${e.message}`);
    }
  },

  async removeManagedTeam(teamId) {
    UI.clearError('manage-teams-error');

    const inFixture = State.fixtures.some(f => f.home_team === teamId || f.away_team === teamId);
    if (inFixture) {
      UI.showError('manage-teams-error', 'manage-teams-error-msg',
                   "This team is already in the generated bracket/schedule. Removing a team mid-bracket still isn't supported — the re-seed system handles correcting a match RESULT (and cascades any downstream matches that result invalidates), not removing a participant entirely. Delete and regenerate fixtures instead if this team truly needs to come out.");
      return;
    }

    try {
      await pb.collection('teams').delete(teamId);
      Logger.info('removeManagedTeam', { teamId });
      await App._renderManageTeamsList();
    } catch (e) {
      Logger.error('removeManagedTeam failed', { error: e.message });
      UI.showError('manage-teams-error', 'manage-teams-error-msg',
                   `Couldn't remove team: ${e.message}`);
    }
  },

  /* ── 11d. NAMES SCREEN ───────────────────────────────────────────────── */

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
    if (!rows.length) {
      UI.showError('setup-error', 'setup-error-msg', 'Add at least one category.');
      return;
    }

    const specs = [];
    const seen  = new Set();
    for (const row of rows) {
      const ageGroup = row.querySelector('.cat-age-group')?.value || '';
      const genders  = [...row.querySelectorAll('.cat-gender-check:checked')].map(cb => cb.value);

      if (!ageGroup) {
        UI.showError('setup-error', 'setup-error-msg', 'Every category needs an age group.');
        return;
      }
      if (!genders.length) {
        UI.showError('setup-error', 'setup-error-msg', `Check at least one gender for ${ageGroup}.`);
        return;
      }
      for (const gender of genders) {
        const key = `${ageGroup}|${gender}`;
        if (seen.has(key)) {
          UI.showError('setup-error', 'setup-error-msg', `Duplicate category: ${ageGroup} ${gender}.`);
          return;
        }
        seen.add(key);
        specs.push({ ageGroup, gender });
      }
    }

    const eventName = [series, edition].filter(Boolean).join(' ');
    const deadlineEl = document.getElementById('registration-deadline');
    const registrationDeadline = deadlineEl?.value
    ? new Date(`${deadlineEl.value}T23:59:59`).toISOString()
    : null;

    const btn = event?.target;
    if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }

    try {
      const created = [];
      for (const spec of specs) {
        const name = [spec.ageGroup, spec.gender].filter(Boolean).join(' ') || 'Open';
        const tournament = await DB.createTournament(
          name, 'round_robin', eventName || null, series || null, edition || null,
          registrationDeadline, spec.gender, spec.ageGroup, null,
        );
        created.push(tournament);
      }

      const bannerEl = document.getElementById('tournament-banner');
      if (bannerEl?.files?.[0]) {
        for (const t of created) {
          try { await DB.uploadTournamentBanner(t.id, bannerEl.files[0]); }
          catch (e) { Logger.warn('Banner upload failed for one category', { error: e.message }); }
        }
      }

      Logger.info('Categories created', { count: created.length, names: created.map(t => t.name) });

      App.goToHome();
      const msg = created.length > 1
      ? `Created ${created.length} categories under "${eventName}". Add teams as they register — no rush.`
      : `"${created[0].name}" created. Add teams as they register — no rush.`;
      UI.showSuccess('home-success', 'home-success-msg', msg);

    } catch (e) {
      Logger.error('Category creation failed', { error: e.message });
      UI.showError('setup-error', 'setup-error-msg', `Couldn't create: ${e.message}`);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Create categories →'; }
    }
  },


  async _persistFixtures(tournamentId, generated, teamMap) {
    Logger.info('_persistFixtures', { type: generated.type });

    if (generated.type === 'elimination') {
      const savedFixtureMap = {};

      for (const round of generated.rounds) {
        for (let mi = 0; mi < round.matches.length; mi++) {
          const m      = round.matches[mi];
          const key    = `R${round.roundNumber}M${mi + 1}`;
          const homeId = (!m.isBye && m.a !== 'TBD' && teamMap[m.a]) ? teamMap[m.a] : null;
          const awayId = (!m.isBye && m.b !== 'TBD' && m.b !== 'BYE' && teamMap[m.b]) ? teamMap[m.b] : null;

          const saved = await DB.createFixture({
            tournament  : tournamentId,
            round       : round.roundNumber,
            match_number: mi + 1,
            round_label : round.label,
            home_team   : homeId,
            away_team   : awayId,
            is_bye      : m.isBye,
            status      : m.isBye ? 'completed' : 'scheduled',
            group_name  : null,
          });
          savedFixtureMap[key] = saved;
        }
      }

      for (let mi = 0; mi < generated.rounds[0].matches.length; mi++) {
        const m = generated.rounds[0].matches[mi];
        if (!m.isBye) continue;
        const slot   = m.nextSlot === 'home' ? 'home_team' : 'away_team';
        const nextFx = savedFixtureMap[`R2M${m.nextMatchNumber}`];
        if (nextFx) {
          await pb.collection('fixtures').update(nextFx.id, { [slot]: teamMap[m.a] });
          Logger.info('Bye winner seeded', { team: m.a, slot });
        }
      }

    } else if (generated.type === 'group_stage') {
      let roundOffset = 0;

      for (const group of generated.groupFixtures) {
        for (let ri = 0; ri < group.rounds.length; ri++) {
          const round = group.rounds[ri];
          for (let mi = 0; mi < round.matches.length; mi++) {
            const m = round.matches[mi];
            await DB.createFixture({
              tournament  : tournamentId,
              round       : roundOffset + ri + 1,
              match_number: mi + 1,
              round_label : round.label,
              home_team   : teamMap[m.a] ?? null,
              away_team   : teamMap[m.b] ?? null,
              is_bye      : false,
              status      : 'scheduled',
              group_name  : group.name,
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
            tournament  : tournamentId,
            round       : roundOffset + ri + 1,
            match_number: mi + 1,
            round_label : round.label,
            home_team   : null,
            away_team   : null,
            is_bye      : m.isBye,
            status      : 'scheduled',
            group_name  : null,
          });
        }
      }

    } else {
      for (let ri = 0; ri < generated.rounds.length; ri++) {
        const round = generated.rounds[ri];
        for (let mi = 0; mi < round.matches.length; mi++) {
          const m = round.matches[mi];
          await DB.createFixture({
            tournament  : tournamentId,
            round       : ri + 1,
            match_number: mi + 1,
            round_label : round.label,
            home_team   : teamMap[m.a] ?? null,
            away_team   : teamMap[m.b] ?? null,
            is_bye      : false,
            status      : 'scheduled',
            group_name  : null,
          });
        }
      }
    }
  },


  _hasAnyResult() {
    return (State.fixtures || []).some(f => !f.is_bye && f.status === 'completed');
  },

  async regenerateFixtures() {
    const t = State.activeTournament;
    if (App._hasAnyResult()) {
      alert("Can't regenerate — this category already has recorded results. Delete the tournament and start over if you truly need to.");
      return;
    }
    if (!confirm('Delete current fixtures and go back to roster editing? This cannot be undone.')) return;

    const btn = document.getElementById('btn-regenerate');
    if (btn) { btn.disabled = true; btn.textContent = 'Regenerating…'; }

    try {
      await DB.deleteFixturesForTournament(t.id);
      await DB.updateTournament(t.id, { status: 'pending' });
      State.activeTournament.status = 'pending';
      State.fixtures = [];
      await App._renderRosterScreen(t);
      UI.showScreen('screen-names');
    } catch (e) {
      Logger.error('regenerateFixtures failed', { error: e.message });
      alert(`Couldn't regenerate: ${e.message}`);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '↺ Regenerate fixtures'; }
    }
  },
  /* ── 11f. FIXTURES SCREEN ────────────────────────────────────────────── */

  _renderFixturesScreen(activeTab = 0) {
    const t  = State.activeTournament;
    const fx = State.fixtures;

    const categoryBadge = t.name && t.name !== 'Open'
    ? `<span style="font-size:11px;color:var(--accent);background:var(--bg-success);
    border-radius:4px;padding:2px 7px;border:0.5px solid var(--accent);
    opacity:0.8;">
    ${escHtml(t.name)}
    </span>`
    : '';

    document.getElementById('sched-title').textContent = t.event_name || t.name;
    document.getElementById('sched-meta').innerHTML =`${State.teams.length} teams · ${t.format.replace(/_/g, ' ')} ${categoryBadge}`;

    const manageTeamsBtn = document.getElementById('btn-manage-teams');
    if (manageTeamsBtn) manageTeamsBtn.style.display = Auth.isAdmin() ? '' : 'none';

    const regenBtn = document.getElementById('btn-regenerate');
    if (regenBtn) regenBtn.style.display = (Auth.isAdmin() && !App._hasAnyResult()) ? '' : 'none';

    const resultsBtn = document.getElementById('btn-results');
    if (resultsBtn) resultsBtn.style.display = t.status === 'completed' ? '' : 'none';

    const realFx = fx.filter(f => !f.is_bye);
    const done   = realFx.filter(f => f.status === 'completed').length;
    const rounds = [...new Set(fx.map(f => f.round))].length;

    document.getElementById('stats-row').innerHTML = `
    <div class="stat-box"><div class="stat-val">${State.teams.length}</div><div class="stat-lbl">Teams</div></div>
    <div class="stat-box"><div class="stat-val">${done}/${realFx.length}</div><div class="stat-lbl">Played</div></div>
    <div class="stat-box"><div class="stat-val">${rounds}</div><div class="stat-lbl">Rounds</div></div>`;

    if (t.format === 'round_robin') {
      document.getElementById('tab-row').innerHTML =
      '<button class="tab" onclick="UI.switchTab(0)">Schedule</button>';
      document.getElementById('tab-panels').innerHTML =
      `<div class="tab-panel">${App._renderScheduleList(fx)}</div>`;

    } else if (t.format === 'elimination') {
      document.getElementById('tab-row').innerHTML = `
      <button class="tab" onclick="UI.switchTab(0)">Schedule</button>
      <button class="tab" onclick="UI.switchTab(1)">Bracket</button>`;
      document.getElementById('tab-panels').innerHTML = `
      <div class="tab-panel">${App._renderScheduleList(fx)}</div>
      <div class="tab-panel">${App._renderNbaBracket(fx)}</div>`;

    } else {
      const groupFx    = fx.filter(f => f.group_name);
      const knockoutFx = fx.filter(f => !f.group_name);
      document.getElementById('tab-row').innerHTML = `
      <button class="tab" onclick="UI.switchTab(0)">Groups</button>
      <button class="tab" onclick="UI.switchTab(1)">Standings</button>
      <button class="tab" onclick="UI.switchTab(2)">Knockout</button>`;
      document.getElementById('tab-panels').innerHTML = `
      <div class="tab-panel">${App._renderGroupSchedule(groupFx)}</div>
      <div class="tab-panel">${App._renderGroupStandings()}</div>
      <div class="tab-panel">${App._renderScheduleList(knockoutFx)}</div>`;
    }

    UI.switchTab(Math.min(activeTab, document.querySelectorAll('.tab').length - 1));
  },

  _renderScheduleList(fixtures) {
    const rounds = {};
    fixtures.filter(f => !f.is_bye).forEach(f => {
      const key = f.round_label || `Round ${f.round}`;
      if (!rounds[key]) rounds[key] = [];
      rounds[key].push(f);
    });
    if (!Object.keys(rounds).length) {
      return '<div class="text-muted" style="padding:1rem 0">No matches yet.</div>';
    }
    return Object.entries(rounds).map(([label, matches]) =>
    `<div class="round-section">
    <div class="round-label">${label}</div>
    ${matches.map((m, i) => App._matchCard(m, i + 1)).join('')}
    </div>`
    ).join('');
  },

  _renderGroupSchedule(fixtures) {
    const groups = {};
    fixtures.filter(f => !f.is_bye).forEach(f => {
      const key = f.group_name || 'Group';
      if (!groups[key]) groups[key] = [];
      groups[key].push(f);
    });
    return Object.entries(groups).map(([name, matches]) =>
    `<div class="round-section">
    <div class="round-label">${name}</div>
    ${matches.map((m, i) => App._matchCard(m, i + 1)).join('')}
    </div>`
    ).join('');
  },

  _renderGroupStandings() {
    const groupNames = [...new Set(
      State.fixtures.filter(f => f.group_name).map(f => f.group_name)
    )].sort();

    if (!groupNames.length) {
      return '<div class="text-muted" style="padding:1rem 0">No group data yet.</div>';
    }

    return groupNames.map(gName => {
      const rows      = _computeGroupStandings(State.fixtures, State.teams, gName);
      const tableRows = rows.map((s, i) => {
        const adv = i < 2;
        return `<tr style="${adv ? 'background:var(--bg-success)' : ''}">
        <td style="padding:6px 8px;font-size:12px;font-weight:500;
        color:${adv ? 'var(--accent)' : 'var(--text-secondary)'}">
        ${i + 1}${adv ? ' ✓' : ''}
        </td>
        <td style="padding:6px 8px;font-size:13px;font-weight:${adv ? '600' : '400'}">
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
      <div class="round-label">${gName}
      <span style="font-size:10px;color:var(--text-tertiary);font-style:italic"> ✓ advances</span>
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
    }).join('');
  },

  _renderNbaBracket(fixtures) {
    const rounds = {};
    fixtures.filter(f => !f.is_bye).forEach(f => {
      if (!rounds[f.round]) rounds[f.round] = [];
      rounds[f.round].push(f);
    });

    const roundNums = Object.keys(rounds).map(Number).sort((a, b) => a - b);
    if (!roundNums.length) return '<div class="text-muted" style="padding:1rem 0">No bracket data yet.</div>';

    const CARD_H = 68, CARD_GAP = 12, COL_W = 180, COL_GAP = 40, PADDING_V = 20;
    const r1Count = rounds[roundNums[0]].length;
    const canvasH = r1Count * CARD_H + (r1Count - 1) * CARD_GAP + PADDING_V * 2;

    function cardCentreY(index, total) {
      const totalH = total * CARD_H + (total - 1) * CARD_GAP;
      const startY = (canvasH - totalH) / 2;
      return startY + index * (CARD_H + CARD_GAP) + CARD_H / 2;
    }

    const cols = roundNums.map((roundNum, colIdx) => {
      const matches = rounds[roundNum];
      const total   = matches.length;
      const label   = matches[0]?.round_label || `Round ${roundNum}`;

      const cards = matches.map((m, i) => {
        const hn     = m.expand?.home_team?.name || 'TBD';
        const an     = m.expand?.away_team?.name || 'TBD';
        const isDone = m.status === 'completed';
        const wH     = isDone && m.winner === m.home_team;
        const wA     = isDone && m.winner === m.away_team;
        const can    = !isDone && hn !== 'TBD' && an !== 'TBD' && Auth.canEnterScores(m.tournament);
        const totalH = total * CARD_H + (total - 1) * CARD_GAP;
        const top    = (canvasH - totalH) / 2 + i * (CARD_H + CARD_GAP);

        return `<div class="nba-match ${isDone ? 'done' : ''} ${can ? 'clickable' : ''} ${hn === 'TBD' && an === 'TBD' ? 'tbd-match' : ''}"
        style="top:${top}px;width:${COL_W}px;"
        ${can ? `onclick="App.openScoreModal('${m.id}')"` : ''}>
        <div class="nba-team ${wH ? 'winner' : ''} ${hn === 'TBD' ? 'tbd' : ''}">
        <span class="nba-seed">${m.expand?.home_team ? State.teams.findIndex(t => t.id === m.home_team) + 1 : ''}</span>
        <span class="nba-name">${escHtml(hn)}</span>
        ${isDone ? `<span class="nba-score">${m.home_score}</span>` : ''}
        </div>
        <div class="nba-divider"></div>
        <div class="nba-team ${wA ? 'winner' : ''} ${an === 'TBD' ? 'tbd' : ''}">
        <span class="nba-seed">${m.expand?.away_team ? State.teams.findIndex(t => t.id === m.away_team) + 1 : ''}</span>
        <span class="nba-name">${escHtml(an)}</span>
        ${isDone ? `<span class="nba-score">${m.away_score}</span>` : ''}
        </div>
        </div>`;
      }).join('');

      return `<div class="nba-round" style="min-width:${COL_W}px;margin-right:${colIdx < roundNums.length - 1 ? COL_GAP : 0}px;">
      <div class="nba-round-label">${escHtml(label)}</div>
      <div class="nba-col" style="height:${canvasH}px;position:relative;">${cards}</div>
      </div>`;
    }).join('');

    let svgLines = '';
    for (let ci = 0; ci < roundNums.length - 1; ci++) {
      const thisRound = rounds[roundNums[ci]];
      const nextRound = rounds[roundNums[ci + 1]];
      const colLeft   = (COL_W + COL_GAP) * (ci + 1) - COL_GAP;

      for (let mi = 0; mi < thisRound.length; mi++) {
        const parentIdx = Math.floor(mi / 2);
        if (parentIdx >= nextRound.length) continue;
        const fromY = cardCentreY(mi, thisRound.length);
        const toY   = cardCentreY(parentIdx, nextRound.length);
        const midX  = colLeft + COL_GAP / 2;

        svgLines += `<line x1="${colLeft}" y1="${fromY}" x2="${midX}" y2="${fromY}" stroke="var(--border-mid)" stroke-width="1.5"/>`;
        if (mi % 2 === 0 && mi + 1 < thisRound.length) {
          svgLines += `<line x1="${midX}" y1="${fromY}" x2="${midX}" y2="${cardCentreY(mi+1,thisRound.length)}" stroke="var(--border-mid)" stroke-width="1.5"/>`;
        }
        if (mi % 2 === 0) {
          svgLines += `<line x1="${midX}" y1="${toY}" x2="${colLeft+COL_GAP}" y2="${toY}" stroke="var(--border-mid)" stroke-width="1.5"/>`;
        }
      }
    }

    const totalW = roundNums.length * COL_W + (roundNums.length - 1) * COL_GAP + 2;
    const svg    = `<svg width="${totalW}" height="${canvasH+24}"
    style="position:absolute;top:24px;left:0;pointer-events:none;overflow:visible">
    ${svgLines}
    </svg>`;

    return `
    <style>
    .nba-bracket-wrap{overflow-x:auto;padding-bottom:1rem}
    .nba-bracket{display:flex;align-items:flex-start;position:relative;min-width:max-content}
    .nba-round{display:flex;flex-direction:column}
    .nba-round-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--text-tertiary);text-align:center;padding-bottom:8px;height:24px;display:flex;align-items:center;justify-content:center}
    .nba-col{position:relative}
    .nba-match{position:absolute;background:var(--bg-primary);border:1px solid var(--border-light);border-radius:var(--radius-md);overflow:hidden;transition:border-color .15s,box-shadow .15s}
    .nba-match.clickable{cursor:pointer}
    .nba-match.clickable:hover{border-color:var(--accent);box-shadow:0 2px 10px rgba(29,158,117,.18)}
    .nba-match.done{border-color:var(--accent)}
    .nba-match.tbd-match{opacity:.45}
    .nba-team{display:flex;align-items:center;gap:6px;padding:6px 8px;height:34px;font-size:12px;min-width:0}
    .nba-team.winner{background:var(--bg-success)}
    .nba-team.tbd{opacity:.6}
    .nba-divider{height:1px;background:var(--border-light)}
    .nba-seed{font-size:10px;color:var(--text-tertiary);min-width:14px;text-align:right;flex-shrink:0}
    .nba-name{flex:1;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-primary)}
    .nba-team.winner .nba-name{color:var(--accent);font-weight:600}
    .nba-team.tbd .nba-name{color:var(--text-tertiary);font-style:italic;font-weight:400}
    .nba-score{font-size:12px;font-weight:700;color:var(--text-tertiary);flex-shrink:0;margin-left:4px}
    .nba-team.winner .nba-score{color:var(--accent)}
    .nba-connectors{position:absolute;top:0;left:0;pointer-events:none}
    </style>
    <div class="nba-bracket-wrap">
    <div class="nba-bracket">${svg}${cols}</div>
    </div>`;
  },

  _matchCard(fixture, num) {
    const homeName = fixture.expand?.home_team?.name || 'TBD';
    const awayName = fixture.expand?.away_team?.name || 'TBD';
    const isDone   = fixture.status === 'completed';
    const canEnter = !isDone && homeName !== 'TBD' && awayName !== 'TBD' && Auth.canEnterScores(fixture.tournament);
    const wHome    = isDone && fixture.winner === fixture.home_team;
    const wAway    = isDone && fixture.winner === fixture.away_team;

    const scoreHtml = isDone
    ? `<span class="match-score">${fixture.home_score} – ${fixture.away_score}</span>`
    : canEnter ? `<span class="match-action">Tap to enter</span>` : '';

    const editBtn = isDone && Auth.canEnterScores(fixture.tournament)
    ? `<button class="btn sm ghost" onclick="App.openEditModal('${fixture.id}')" title="Edit result">✏️</button>`
    : '';

    const canSetTimeCourt = Auth.canEnterScores(fixture.tournament) && homeName !== 'TBD' && awayName !== 'TBD';
    const timeCourtBtn = canSetTimeCourt
    ? `<button class="btn sm ghost" onclick="App.quickSetTimeCourt(event, '${fixture.id}')" title="Set time/court">🕐</button>`
    : '';
    const timeCourtChip = (fixture.scheduled_time || fixture.court_label)
    ? `<div class="match-timecourt-chip">
    ${fixture.scheduled_time ? escHtml(fixture.scheduled_time) : ''}
    ${fixture.scheduled_time && fixture.court_label ? ' • ' : ''}
    ${fixture.court_label ? escHtml(fixture.court_label) : ''}
    </div>`
    : '';

    return `<div class="match-card ${isDone ? 'completed' : ''} ${canEnter ? 'clickable' : ''}"
    ${canEnter ? `onclick="App.openScoreModal('${fixture.id}')"` : ''}>
    <span class="match-num">M${num}</span>
    <span class="team-a ${homeName==='TBD'?'tbd':''} ${wHome?'winner-bold':''}">${escHtml(homeName)}</span>
    <span class="vs">vs</span>
    <span class="team-b ${awayName==='TBD'?'tbd':''} ${wAway?'winner-bold':''}">${escHtml(awayName)}</span>
    ${scoreHtml}
    ${editBtn}
    ${timeCourtBtn}
    ${timeCourtChip}
    </div>`;
  },

  async quickSetTimeCourt(event, fixtureId) {
    event.stopPropagation();
    try {
      const fixture = await pb.collection('fixtures').getOne(fixtureId);
      const time  = prompt('Time (e.g. "14:30 EAT") — leave blank to clear:', fixture.scheduled_time || '');
      if (time === null) return;
      const court = prompt('Court (e.g. "Court 1") — leave blank to clear:', fixture.court_label || '');
      if (court === null) return;

      await pb.collection('fixtures').update(fixtureId, {
        scheduled_time: time.trim(),
                                             court_label   : court.trim(),
      });
      Logger.info('App.quickSetTimeCourt', { fixtureId, time, court });
      await App._renderFixturesScreen();
    } catch (e) {
      Logger.error('App.quickSetTimeCourt failed', { error: e.message });
      alert(`Couldn't save: ${e.message}`);
    }
  },

  /* ── 11g. SCORE ENTRY ────────────────────────────────────────────────── */

  async openScoreModal(fixtureId) {
    try {
      const fixture = await pb.collection('fixtures').getOne(fixtureId, {
        expand: 'home_team,away_team,winner',
      });
      await UI.openModal(fixture, false);
    } catch (e) {
      Logger.error('openScoreModal failed', { error: e.message });
    }
  },

  async openEditModal(fixtureId) {
    try {
      const fixture = await pb.collection('fixtures').getOne(fixtureId, {
        expand: 'home_team,away_team,winner',
      });
      await UI.openModal(fixture, true);
    } catch (e) {
      Logger.error('openEditModal failed', { error: e.message });
    }
  },

  async saveResult() {
    const fixture = State.activeFixture;
    const isEdit  = State.isEditMode;
    if (!fixture) return;

    const homeScore = parseInt(document.getElementById('score-home').value, 10);
    const awayScore = parseInt(document.getElementById('score-away').value, 10);
    const errEl     = document.getElementById('modal-error');
    errEl.classList.remove('visible');

    if (isNaN(homeScore) || isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
      errEl.textContent = 'Enter valid scores (0 or higher) for both teams.';
      errEl.classList.add('visible');
      return;
    }
    if (homeScore === awayScore) {
      errEl.textContent = 'Scores cannot be equal — there must be a winner.';
      errEl.classList.add('visible');
      return;
    }

    const winnerId = homeScore > awayScore ? fixture.home_team : fixture.away_team;
    const isBracketMatch =
    State.activeTournament.format === 'elimination' ||
    (State.activeTournament.format === 'group_stage' && !fixture.group_name);

    const scheduledTime = document.getElementById('modal-scheduled-time')?.value.trim() || null;
    const court          = document.getElementById('modal-court')?.value || null;

    const winnerChanging = isEdit && isBracketMatch && fixture.winner && fixture.winner !== winnerId;
    if (winnerChanging) {
      const btn = document.getElementById('btn-save-result');
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Checking...'; }
      try {
        const impact = await DB.getBracketImpact(fixture.tournament, fixture.round, fixture.match_number);
        if (impact.length > 0) {
          App._pendingReseed = { fixture, homeScore, awayScore, winnerId, scheduledTime, court, isEdit };
          App._showReseedConfirm(impact);
          return;
        }
      } catch (e) {
        Logger.error('getBracketImpact failed', { error: e.message });
        errEl.textContent = `Couldn't check downstream impact: ${e.message}`;
        errEl.classList.add('visible');
        return;
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = 'Save result'; }
      }
    }

    await App._commitResult(fixture, homeScore, awayScore, winnerId, isEdit, scheduledTime, court);
  },

  async _commitResult(fixture, homeScore, awayScore, winnerId, isEdit, scheduledTime, court) {
    const activeTabIdx = (() => {
      const tabs = document.querySelectorAll('.tab');
      for (let i = 0; i < tabs.length; i++) {
        if (tabs[i].classList.contains('active')) return i;
      }
      return 0;
    })();

    const btn = document.getElementById('btn-save-result');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving...'; }
    const errEl = document.getElementById('modal-error');

    try {
      const isBracketMatch =
      State.activeTournament.format === 'elimination' ||
      (State.activeTournament.format === 'group_stage' && !fixture.group_name);

      const wasCompletedBefore = State.activeTournament.status === 'completed';

      await DB.saveFixtureResult(fixture.id, homeScore, awayScore, winnerId, scheduledTime, court);

      let resetFixtures = [];
      if (isBracketMatch) {
        resetFixtures = await DB.cascadeReseed(fixture.tournament, fixture.round, fixture.match_number, winnerId);
      }

      let groupJustFinished = false;
      if (State.activeTournament.format === 'group_stage') {
        const seeded = await DB.seedKnockoutFromGroups(fixture.tournament, State.teams);
        if (seeded) groupJustFinished = true;
      }

      State.fixtures = await DB.getFixtures(fixture.tournament);

      const realFx  = State.fixtures.filter(f => !f.is_bye);
      const allDone = realFx.every(f => f.status === 'completed');
      const status  = allDone ? 'completed' : 'active';
      await DB.updateTournament(fixture.tournament, { status });
      State.activeTournament.status = status;

      if (allDone) {
        Logger.info('Tournament complete — saving team stats to databank');
        await DB.saveTeamStats(fixture.tournament, State.fixtures, State.teams);
      } else if (wasCompletedBefore && resetFixtures.length) {
        const staleStats = await pb.collection('team_stats').getFullList({
          filter: `tournament="${fixture.tournament}"`, fields: 'id', requestKey: null,
        });
        await Promise.all(staleStats.map(s => pb.collection('team_stats').delete(s.id)));
        Logger.info('Cleared stale team_stats after re-seed reopened a completed tournament', { count: staleStats.length });
      }

      document.getElementById('modal-overlay').classList.remove('open');
      State.activeFixture = null;
      State.isEditMode    = false;

      App._renderFixturesScreen(groupJustFinished ? 2 : activeTabIdx);
      const msg = resetFixtures.length
      ? `Result updated — ${resetFixtures.length} downstream match${resetFixtures.length === 1 ? '' : 'es'} reset and will need to be replayed.`
      : (isEdit ? 'Result updated.' : 'Result saved.');
      UI.showSuccess('fixtures-success', 'fixtures-success-msg', msg);

    } catch (e) {
      Logger.error('saveResult failed', { error: e.message, stack: e.stack });
      if (errEl) {
        errEl.textContent = `Save failed: ${e.message}`;
        errEl.classList.add('visible');
      }
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = 'Save result'; }
    }
  },

  _showReseedConfirm(impact) {
    const listEl = document.getElementById('reseed-impact-list');
    if (listEl) {
      listEl.innerHTML = impact.map(fx => {
        const home = fx.expand?.home_team?.name || 'TBD';
        const away = fx.expand?.away_team?.name || 'TBD';
        return `<li>Round ${fx.round}: ${escHtml(home)} ${fx.home_score ?? '–'} – ${fx.away_score ?? '–'} ${escHtml(away)}</li>`;
      }).join('');
    }
    document.getElementById('reseed-confirm-overlay')?.classList.add('open');
  },

  closeReseedConfirm() {
    document.getElementById('reseed-confirm-overlay')?.classList.remove('open');
    App._pendingReseed = null;
  },

  async confirmReseed() {
    const pending = App._pendingReseed;
    if (!pending) return;
    document.getElementById('reseed-confirm-overlay')?.classList.remove('open');
    App._pendingReseed = null;
    await App._commitResult(pending.fixture, pending.homeScore, pending.awayScore,
                            pending.winnerId, pending.isEdit, pending.scheduledTime, pending.court);
  },

  /* ── ORGANISE EVENTS MODAL ───────────────────────────────────────────── */

  async openOrganiseModal() {
    const overlay = document.getElementById('organise-overlay');
    const list    = document.getElementById('organise-list');
    if (!overlay || !list) return;

    overlay.style.display = 'block';
    list.innerHTML = '<div style="color:var(--text-tertiary);font-size:13px;">Loading...</div>';

    try {
      const [tournaments, existingEvents] = await Promise.all([
        DB.getTournaments(),
                                                              DB.getEvents(),
      ]);

      const datalistHtml = `<datalist id="organise-event-suggestions">
      ${existingEvents.map(e => `<option value="${escHtml(e)}">`).join('')}
      </datalist>`;

      list.innerHTML = datalistHtml + tournaments.map(t => `
      <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;
      padding:8px 10px;background:var(--bg-secondary);border-radius:var(--radius-md);
      border:0.5px solid var(--border-light);">
      <div>
      <div style="font-size:13px;font-weight:500;color:var(--text-primary);">
      ${escHtml(t.name)}
      <span class="status-badge badge-${t.status}" style="margin-left:6px;">${t.status}</span>
      </div>
      <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">
      ${t.format.replace(/_/g,' ')} · ${new Date(t.created).toLocaleDateString()}
      </div>
      </div>
      <input type="text"
      class="organise-event-input"
      data-tournament-id="${t.id}"
      value="${escHtml(t.event_name || '')}"
      placeholder="Event name"
      list="organise-event-suggestions"
      maxlength="60"
      style="width:160px;font-size:12px;padding:5px 8px;" />
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
    const btn    = document.getElementById('btn-save-organise');
    const errEl  = document.getElementById('organise-error');
    const inputs = document.querySelectorAll('.organise-event-input');

    errEl.style.display = 'none';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving...'; }

    try {
      let changeCount = 0;
      for (const input of inputs) {
        const tournamentId = input.dataset.tournamentId;
        const newEvent     = input.value.trim() || null;
        const current      = await pb.collection('tournaments').getOne(tournamentId, { fields: 'id,event_name' });
        const currentEvent = current.event_name || null;
        if (newEvent !== currentEvent) {
          await pb.collection('tournaments').update(tournamentId, { event_name: newEvent });
          changeCount++;
        }
      }

      document.getElementById('organise-overlay').style.display = 'none';
      await App.loadTournaments();
      UI.showSuccess('home-success', 'home-success-msg',
                     changeCount > 0
                     ? `${changeCount} tournament${changeCount === 1 ? '' : 's'} updated.`
                     : 'No changes made.'
      );

    } catch (e) {
      errEl.textContent   = `Save failed: ${e.message}`;
      errEl.style.display = 'block';
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = 'Save changes'; }
    }
  },

};  // ← end of App object

/* =============================================================================
 * GLOBAL ERROR HANDLERS
 * ============================================================================= */
window.addEventListener('error', e => {
  Logger.error('Uncaught error', { message: e.message, file: e.filename, line: e.lineno });
});
window.addEventListener('unhandledrejection', e => {
  Logger.error('Unhandled promise rejection', { reason: String(e.reason) });
});

/* =============================================================================
 * BOOT
 * ============================================================================= */
document.addEventListener('DOMContentLoaded', () => {
  Logger.info('DOM ready — booting Tournament Manager v5.1.0');
  if (document.getElementById('screen-home')) {
    App.init().catch(e => Logger.error('App.init failed', { error: e.message }));
  }
});
