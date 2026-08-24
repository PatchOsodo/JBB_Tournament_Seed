/**
 * =============================================================================
 * users.js — Admin-only user management: role visibility + score-inputter
 * tournament assignment.
 *
 * Depends on: config.js, logger.js, auth.js (shared pb + Auth)
 * =============================================================================
 */

const Users = {

  allTournaments : [],   // cached for the assign modal
  editingUserId  : null, // which user the assign modal is currently open for

  async init() {
    if (!Auth.isAdmin()) {
      document.getElementById('not-admin-notice').style.display = '';
      Logger.info('Users.init blocked — not an admin');
      return;
    }

    try {
      Users.allTournaments = await pb.collection('tournaments').getFullList({
        sort : '-created',
        fields: 'id,name,status',
      });
    } catch (e) {
      Logger.error('Users.init tournaments load failed', { error: e.message });
    }

    await Users.load();
  },

  async load() {
    const list = document.getElementById('users-list');
    try {
      const users = await pb.collection('users').getFullList({ sort: 'name' });
      Logger.info('Users.load', { count: users.length });

      if (!users.length) {
        list.innerHTML = `<div class="empty-state">
          <span class="empty-icon">👥</span>
          No users found.
        </div>`;
        return;
      }

      list.innerHTML = users.map(Users._userCard).join('');
    } catch (e) {
      Logger.error('Users.load failed', { error: e.message });
      UI.showError('users-error', 'users-error-msg', `Could not load users: ${e.message}`);
      list.innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span>Couldn\'t load users right now — check your connection and try again.</div>';
    }
  },

  _roleLabel(role) {
    return {
      super_admin    : '⚡ Super Admin',
      tournament_admin: '✏️ Tournament Admin',
      score_inputter : '🖊️ Score Inputter',
      fan            : '⭐ Fan',
    }[role] || role || '—';
  },

  _userCard(u) {
    const name  = _esc(u.name || u.email);
    const email = _esc(u.email);
    const roleLabel = Users._roleLabel(u.role);
    const assignedCount = (u.assigned_tournaments || []).length;

    const assignRow = u.role === 'score_inputter'
      ? `<div style="margin-top:8px;display:flex;align-items:center;gap:10px;">
           <span style="font-size:12px;color:var(--text-secondary);">
             ${assignedCount ? `Assigned to ${assignedCount} tournament${assignedCount === 1 ? '' : 's'}` : 'Not assigned to any tournament yet'}
           </span>
           <button class="btn sm ghost" onclick="Users.openAssignModal('${u.id}')">Manage tournaments</button>
         </div>`
      : '';

    return `<div class="card" style="padding:14px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
        <div>
          <div style="font-weight:500;font-size:14px;">${name}</div>
          <div style="font-size:12px;color:var(--text-tertiary);">${email}</div>
        </div>
        <span class="badge-teal" style="font-size:11px;padding:3px 8px;border-radius:20px;white-space:nowrap;">${roleLabel}</span>
      </div>
      ${assignRow}
    </div>`;
  },

  openCreateModal() {
    document.getElementById('create-name').value = '';
    document.getElementById('create-username').value = '';
    document.getElementById('create-email').value = '';
    document.getElementById('create-password').value = '';
    document.getElementById('create-role').value = 'score_inputter';
    document.getElementById('create-modal-error').classList.remove('visible');
    document.getElementById('create-modal-overlay').classList.add('open');
  },

  closeCreateModal() {
    document.getElementById('create-modal-overlay').classList.remove('open');
  },

  async createUser() {
    const name     = document.getElementById('create-name').value.trim();
    const role     = document.getElementById('create-role').value;
    const username = document.getElementById('create-username').value.trim();
    const email    = document.getElementById('create-email').value.trim();
    const password = document.getElementById('create-password').value;
    const errEl    = document.getElementById('create-modal-error');

    if (!email || !password || password.length < 8) {
      errEl.textContent = 'Email and an 8+ character password are required.';
      errEl.classList.add('visible');
      return;
    }

    try {
      await pb.collection('users').create({
        name,
        role,
        username: username || undefined,
        email,
        password,
        passwordConfirm: password,
      });
      Logger.info('Users.createUser', { role, hasUsername: !!username });
      Users.closeAssignModal(); // no-op if not open, just tidy state
      Users.closeCreateModal();
      await Users.load();
    } catch (e) {
      Logger.error('Users.createUser failed', { error: e.message });
      errEl.textContent = `Couldn't create user: ${e.message}`;
      errEl.classList.add('visible');
    }
  },

  openAssignModal(userId) {
    Users.editingUserId = userId;
    pb.collection('users').getOne(userId).then((user) => {
      document.getElementById('assign-modal-title').textContent = `Assign tournaments — ${user.name || user.email}`;
      const assigned = new Set(user.assigned_tournaments || []);

      const listEl = document.getElementById('assign-tournament-list');
      if (!Users.allTournaments.length) {
        listEl.innerHTML = `<p style="font-size:13px;color:var(--text-secondary);">No tournaments exist yet.</p>`;
      } else {
        listEl.innerHTML = Users.allTournaments.map(t => `
          <label style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:0.5px solid var(--border-light);font-size:13px;cursor:pointer;">
            <input type="checkbox" value="${t.id}" ${assigned.has(t.id) ? 'checked' : ''} style="width:16px;height:16px;">
            <span style="flex:1;">${_esc(t.name)}</span>
            <span style="font-size:11px;color:var(--text-tertiary);">${t.status || ''}</span>
          </label>
        `).join('');
      }

      document.getElementById('assign-modal-error').classList.remove('visible');
      document.getElementById('assign-modal-overlay').classList.add('open');
    }).catch((e) => {
      Logger.error('Users.openAssignModal failed', { error: e.message });
    });
  },

  closeAssignModal() {
    document.getElementById('assign-modal-overlay').classList.remove('open');
    Users.editingUserId = null;
  },

  async saveAssignment() {
    if (!Users.editingUserId) return;
    const checked = [...document.querySelectorAll('#assign-tournament-list input[type="checkbox"]:checked')]
      .map(cb => cb.value);

    try {
      await pb.collection('users').update(Users.editingUserId, { assigned_tournaments: checked });
      Logger.info('Users.saveAssignment', { userId: Users.editingUserId, count: checked.length });
      Users.closeAssignModal();
      await Users.load();
    } catch (e) {
      Logger.error('Users.saveAssignment failed', { error: e.message });
      const err = document.getElementById('assign-modal-error');
      err.textContent = `Couldn't save: ${e.message}`;
      err.classList.add('visible');
    }
  },

  _renderAuthBar() {
    const ctrl = document.getElementById('auth-controls');
    if (!ctrl) return;
    const user = Auth.user();

    // Only admins ever see this page load meaningfully, but keep the nav
    // link itself hidden for non-admins across every page for consistency.
    const navUsers = document.getElementById('nav-users');
    if (navUsers) navUsers.style.display = Auth.isAdmin() ? '' : 'none';
    const navCourts = document.getElementById('nav-courts');
    if (navCourts) navCourts.style.display = Auth.isAdmin() ? '' : 'none';

    if (user) {
      const roleLabel = Users._roleLabel(user.role);
      ctrl.innerHTML = `
        <span style="font-size:12px;color:var(--text-secondary);">
          ${_esc(user.name || user.email)}
          <span style="margin-left:6px;font-size:10px;padding:2px 6px;border-radius:4px;
                       background:var(--bg-secondary);color:var(--text-tertiary);
                       border:0.5px solid var(--border-light);">
            ${roleLabel}
          </span>
        </span>
        <button class="btn sm ghost" onclick="Auth.logout()">Sign out</button>`;
    } else {
      ctrl.innerHTML = `
        <span style="font-size:12px;color:var(--text-tertiary);">Browsing as guest</span>
        <a href="login.html" class="btn sm primary">Sign in / Register</a>`;
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

document.addEventListener('DOMContentLoaded', Users.init);
