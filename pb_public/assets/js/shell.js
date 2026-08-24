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
      const res  = await fetch('assets/partials/nav.html');
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
  // the Users/Courts nav links for admins, render sign-in/sign-out state,
  // sync the bottom-nav Account tab (with the inline sheet for signed-in
  // users), and highlight the active nav link.
  renderAuthBar(pb) {
    const user    = pb.authStore.isValid ? pb.authStore.model : null;
    const isAdmin = user?.role === 'super_admin' || user?.role === 'tournament_admin';

    const navUsers = document.getElementById('nav-users');
    if (navUsers) navUsers.style.display = isAdmin ? '' : 'none';
    const navCourts = document.getElementById('nav-courts');
    if (navCourts) navCourts.style.display = isAdmin ? '' : 'none';

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
        bottomAuthItem.onclick   = (e) => { e.preventDefault(); Shell._showAccountSheet(user); };
      } else {
        bottomAuthItem.innerHTML = `<span class="nav-icon">👤</span>Sign in`;
        bottomAuthItem.href      = 'login.html';
        bottomAuthItem.onclick   = null;
      }
    }

    Shell._highlightActiveLink();
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

  _showAccountSheet(user) {
    document.getElementById('_acct-sheet')?.remove();
    const roleLabel = {
      super_admin: '⚡ Super Admin', tournament_admin: '✏️ Admin',
      score_inputter: '🖊️ Score Inputter', fan: '⭐ Fan',
    }[user?.role] || '';

    const sheet = document.createElement('div');
    sheet.id = '_acct-sheet';
    sheet.innerHTML = `
      <div style="position:fixed;inset:0;z-index:299;background:rgba(0,0,0,0.4);"
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
        <button onclick="pb.authStore.clear();window.location.href='login.html';" class="btn sm ghost"
                style="width:100%;justify-content:center;color:var(--danger);border-color:var(--danger);">
          Sign out
        </button>
      </div>`;
    document.body.appendChild(sheet);
  },
};
