/**
* =============================================================================
* shell.js — pb_public/assets/js/shell.js
*
* Shared across ALL pages (public + admin). Replaces the per-page duplicated
* auth-bar renderers previously in: app.js (_renderAuthBar), bracket.js
* (_bracketRenderAuthBar), courts.js (_renderAuthBar), users.js
* (_renderAuthBar), teams.js (inline in _renderAuthBar), stats.html's inline
* <script> (renderAuthBar).
*
* Depends on: nothing required, but uses escHtml from config.js if present
* (falls back to its own if config.js hasn't loaded yet — e.g. bracket.html
* previously didn't load config.js at all).
*
* CHANGES
* -------
* - Phase 12: the mobile Account sheet now includes quick links to
*   Admin/Users/Courts for admins — the top nav where those links normally
*   live is hidden below 600px in favor of the bottom-nav bar, which
*   otherwise gave admins no way to reach those pages on a phone at all.
* - Phase 13 (UI redesign prep, step 2): added Shell.renderCategoryNav() —
*   the single shared definition of the "Overview / Fixtures / Results /
*   Standings / Bracket / Teams registry" tab strip. Previously this exact
*   six-link row was hand-built, near-identically, five separate times
*   (tournament.js, fixtures.js, results.js, standings.js, bracket.js) and
*   not at all in teams.js — meaning a tournament-scoped roster view had no
*   way back into the tab set. All six now call this one function.
* - Phase 14 (nav reorg): desktop admin links now live inside a single
*   "⚙ Admin ▾" dropdown (#nav-admin-menu) instead of five separate items
*   in the top bar. Per-link visibility rules (isAdmin / canScore) are
*   unchanged — only the wrapper's own visibility and the dropdown
*   open/close interaction are new. The mobile Account sheet gained a
*   labeled "ADMINISTRATION" section listing the same five destinations,
*   so admin/score_inputter users on mobile can still reach them (the
*   bottom nav itself stays a strict 4 items: Home/Tournaments/Teams/
*   Account).
*
* Usage on every page, after the pb client exists:
*   await Shell.injectNav();
*   Shell.renderAuthBar(pb);
* =============================================================================
*/

if (typeof escHtml === 'undefined') {
  window.escHtml = function escHtml(str) {
    return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
}

const Shell = {

  // Fetches the shared nav partial and inserts it as the first children of
  // <body>, same fetch+inject pattern already used for assets/icons.svg on
  // stats.html/bracket.html. Pages must remove their own hardcoded
  // <nav class="app-nav">...</nav> and <nav class="bottom-nav">...</nav>
  // blocks so nothing renders twice.
  async injectNav() {
    try {
      const res = await fetch('assets/partials/nav.html');
      if (!res.ok) {
        console.warn(`Shell.injectNav: nav.html returned ${res.status} — confirm it's deployed at pb_public/assets/partials/nav.html`);
        return;
      }
      const html = await res.text();
      const wrap = document.createElement('div');
      wrap.innerHTML = html;
      const frag = document.createDocumentFragment();
      [...wrap.children].forEach(el => frag.appendChild(el));
      document.body.insertBefore(frag, document.body.firstChild);
    } catch (e) {
      console.warn('Shell.injectNav failed', e);
    }
  },

  // One implementation of the auth bar, used by every page. Behavior is
  // identical to what each page did separately before Phase 1: show/hide
  // the Users/Courts/Admin nav links for admins, render sign-in/sign-out
  // state, sync the bottom-nav Account tab (with the inline sheet for
  // signed-in users), and highlight the active nav link.
  renderAuthBar(pb) {
    const user     = pb.authStore.isValid ? pb.authStore.model : null;
    const isAdmin  = user?.role === 'super_admin' || user?.role === 'tournament_admin';
    const canScore = isAdmin || user?.role === 'score_inputter';

    const navUsers = document.getElementById('nav-users');
    if (navUsers) navUsers.style.display = isAdmin ? '' : 'none';
    const navCourts = document.getElementById('nav-courts');
    if (navCourts) navCourts.style.display = isAdmin ? '' : 'none';
    const navAdmin = document.getElementById('nav-admin');
    if (navAdmin) navAdmin.style.display = isAdmin ? '' : 'none';
    const navScores = document.getElementById('nav-scores');
    if (navScores) navScores.style.display = canScore ? '' : 'none';
    const navManage = document.getElementById('nav-manage');
    if (navManage) navManage.style.display = isAdmin ? '' : 'none';

    // Desktop "⚙ Admin ▾" dropdown wrapper — visible whenever ANY child
    // link inside it would be visible (admin or score_inputter). The
    // individual child links above keep deciding their own visibility;
    // this only controls whether the trigger button itself shows up.
    const navAdminMenu = document.getElementById('nav-admin-menu');
    if (navAdminMenu) navAdminMenu.style.display = (isAdmin || canScore) ? '' : 'none';

    const ctrl = document.getElementById('auth-controls');
    if (ctrl) {
      if (user) {
        const roleLabel = {
          super_admin      : '⚡ Super Admin',
   tournament_admin : '✏️ Tournament Admin',
   score_inputter   : '🖊️ Score Inputter',
   fan              : '⭐ Fan',
        }[user.role] || user.role;

        ctrl.innerHTML = `
        <span style="font-size:12px;color:var(--text-secondary);">
        ${escHtml(user.name || user.email)}
        <span style="margin-left:6px;font-size:10px;padding:2px 6px;
        border-radius:4px;background:var(--bg-secondary);
        color:var(--text-tertiary);border:0.5px solid var(--border-light);">
        ${roleLabel}
        </span>
        </span>
        <button class="btn sm ghost" onclick="pb.authStore.clear();window.location.href='login.html';">Sign out</button>`;
      } else {
        ctrl.innerHTML = `
        <span style="font-size:12px;color:var(--text-tertiary);">Browsing as guest</span>
        <a href="login.html" class="btn sm primary">Sign in / Register</a>`;
      }
    }

    const bottomAuthItem = document.getElementById('bottom-nav-auth');
    if (bottomAuthItem) {
      if (user) {
        bottomAuthItem.innerHTML = `<span class="nav-icon">👤</span>${escHtml(user.name?.split(' ')[0] || 'Account')}`;
        bottomAuthItem.href      = '#';
        bottomAuthItem.onclick   = (e) => { e.preventDefault(); Shell._showAccountSheet(user, isAdmin, canScore); };
      } else {
        bottomAuthItem.innerHTML = `<span class="nav-icon">👤</span>Sign in`;
        bottomAuthItem.href      = 'login.html';
        bottomAuthItem.onclick   = null;
      }
    }

    Shell._highlightActiveLink();
    Shell._bindAdminDropdown();
  },

  // ── CATEGORY TAB STRIP ────────────────────────────────────────────────
  // The six links every category-scoped page shares: Overview (the
  // category's tournament.html?id= page), Fixtures, Results, Standings,
  // Bracket, and Teams registry (tournament-scoped). One definition here
  // means the strip only needs restyling in one place — e.g. when this
  // becomes a real tab shell in the visual redesign — instead of six.
  CATEGORY_NAV_LINKS: [
    { key: 'overview',  label: 'Overview',      href: id => `tournament.html?id=${id}` },
    { key: 'fixtures',  label: 'Fixtures',      href: id => `fixtures.html?id=${id}` },
    { key: 'results',   label: 'Results',       href: id => `results.html?id=${id}` },
    { key: 'standings', label: 'Standings',     href: id => `standings.html?id=${id}` },
    { key: 'bracket',   label: 'Bracket',       href: id => `bracket.html?id=${id}` },
    { key: 'teams',     label: 'Teams registry',href: id => `teams.html?tournament=${id}` },
  ],

  // containerId — each page keeps its own existing container element
  // (#tourn-nav, #fx-nav, #res-nav, #st-nav, #bracket-nav, #teams-nav), so
  // no HTML restructuring is needed anywhere this is called from.
  // tournamentId — the category's `tournaments` record id.
  // activeKey — which CATEGORY_NAV_LINKS entry is the current page; it
  // renders as a non-link "primary" pill instead of an <a>, same visual
  // treatment every page already used individually.
  renderCategoryNav(containerId, tournamentId, activeKey) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = Shell.CATEGORY_NAV_LINKS.map(link => {
      if (link.key === activeKey) {
        return `<span class="btn sm primary" style="pointer-events:none;">${escHtml(link.label)}</span>`;
      }
      return `<a class="btn sm ghost" href="${link.href(tournamentId)}">${escHtml(link.label)}</a>`;
    }).join('');
  },

  _highlightActiveLink() {
    const currentPath = window.location.pathname;
    document.querySelectorAll('.nav-link, .bottom-nav-item').forEach(link => {
      const href = link.getAttribute('href');
      link.classList.remove('active');
      if ((currentPath === '/' || currentPath.endsWith('index.html')) && href === 'index.html') {
        link.classList.add('active');
      } else if (href && currentPath.includes(href) && href !== 'index.html') {
        link.classList.add('active');
      }
    });
  },

  // ── DESKTOP ADMIN DROPDOWN — open/close interaction ─────────────────────
  // Delegated on document so it works regardless of when nav.html finished
  // injecting, and never double-binds across repeated renderAuthBar() calls.
  _adminDropdownBound: false,
  _bindAdminDropdown() {
    if (Shell._adminDropdownBound) return;
    Shell._adminDropdownBound = true;

    document.addEventListener('click', (e) => {
      const menu    = document.getElementById('nav-admin-menu');
      const trigger = e.target.closest('#nav-admin-trigger');
      if (trigger) {
        e.preventDefault();
        const isOpen = menu?.classList.toggle('open');
        trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        return;
      }
      // Click outside the open dropdown closes it.
      if (menu && menu.classList.contains('open') && !menu.contains(e.target)) {
        menu.classList.remove('open');
        document.getElementById('nav-admin-trigger')?.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const menu = document.getElementById('nav-admin-menu');
      if (menu?.classList.contains('open')) {
        menu.classList.remove('open');
        document.getElementById('nav-admin-trigger')?.setAttribute('aria-expanded', 'false');
      }
    });

    // Selecting a dropdown item should close the menu behind it (normal
    // navigation happens via the link's own href — this just tidies state
    // for the rare case navigation doesn't unload the page, e.g. same-page
    // anchors, back/forward cache).
    document.addEventListener('click', (e) => {
      if (e.target.closest('.nav-admin-item')) {
        document.getElementById('nav-admin-menu')?.classList.remove('open');
      }
    });
  },

  _showAccountSheet(user, isAdmin, canScore = isAdmin) {
    document.getElementById('_acct-sheet')?.remove();
    const roleLabel = {
      super_admin: '⚡ Super Admin', tournament_admin: '✏️ Admin',
      score_inputter: '🖊️ Score Inputter', fan: '⭐ Fan',
    }[user?.role] || '';

    // Same five destinations as the desktop "⚙ Admin ▾" dropdown, grouped
    // under an "ADMINISTRATION" label — this is how an admin or
    // score_inputter reaches them on mobile, since the bottom nav itself
    // stays a strict 4 items (Home/Tournaments/Teams/Account) and the top
    // nav (where the dropdown lives) is hidden below 600px.
    const adminItems = [];
    if (isAdmin)  adminItems.push({ href: 'admin.html',   icon: '📋', label: 'Dashboard' });
    if (canScore) adminItems.push({ href: 'scores.html',  icon: '⚡', label: 'Score Entry' });
    if (isAdmin)  adminItems.push({ href: 'users.html',   icon: '👥', label: 'Users' });
    if (isAdmin)  adminItems.push({ href: 'courts.html',  icon: '🏟️', label: 'Courts' });
    if (isAdmin)  adminItems.push({ href: 'manage.html',  icon: '🛠️', label: 'Manage' });

    const adminSectionHtml = adminItems.length ? `
    <div class="acct-section-label">Administration</div>
    <div style="margin-bottom:1rem;">
    ${adminItems.map(it => `
      <a href="${it.href}" class="acct-admin-item">
      <span>${it.icon} ${escHtml(it.label)}</span>
      <span class="acct-chevron">›</span>
      </a>`).join('')}
      </div>` : '';

      const sheet = document.createElement('div');
      sheet.id = '_acct-sheet';
      sheet.innerHTML = `
      <div style="position:fixed;inset:0;z-index:299;background:rgba(0,0,0,0.4);"
      onclick="document.getElementById('_acct-sheet').remove()"></div>
      <div style="position:fixed;bottom:60px;left:0;right:0;z-index:300;
      background:var(--bg-primary);border-top:0.5px solid var(--border-light);
      border-radius:var(--radius-lg) var(--radius-lg) 0 0;
      padding:1.25rem 1.5rem 1.5rem;max-width:480px;margin:0 auto;
      max-height:75vh;overflow-y:auto;">
      <div class="acct-section-label">Account</div>
      <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">
      Signed in as: ${escHtml(user?.name || user?.email || '')}
      </div>
      <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:1rem;">
      ${escHtml(user?.email || '')}
      ${roleLabel ? `<span style="margin-left:8px;padding:2px 6px;border-radius:4px;
        background:var(--bg-secondary);border:0.5px solid var(--border-light);">
        ${roleLabel}</span>` : ''}
        </div>
        ${adminSectionHtml}
        <button onclick="pb.authStore.clear();window.location.href='login.html';" class="btn sm ghost"
        style="width:100%;justify-content:center;color:var(--danger);border-color:var(--danger);margin-top:${adminItems.length ? '4px' : '0'};">
        Sign out
        </button>
        </div>`;
        document.body.appendChild(sheet);
  },
};

// Bind the dropdown interaction as soon as this module loads — it's
// delegated on document, so it works even before nav.html finishes
// injecting (the listener just won't find #nav-admin-trigger until then).
Shell._bindAdminDropdown();
