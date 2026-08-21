/**
 * =============================================================================
 * auth.js — PocketBase client + Auth helpers
 *
 * Depends on: config.js, logger.js
 * =============================================================================
 */

// Single PocketBase instance shared across all modules
const pb = new PocketBase(CONFIG.API_BASE_URL);

const Auth = {
  user()           { return pb.authStore.isValid ? pb.authStore.model : null; },
  role()           { return Auth.user()?.role ?? null; },

  // Not logged in at all — just browsing scores.
  isGuest()        { return !pb.authStore.isValid; },

  // Logged in, no special privileges — favourites, personalised home screen.
  isFan()          { return Auth.role() === 'fan'; },

  // Logged in, can enter/edit scores ONLY for tournaments they're assigned to.
  isScoreInputter(){ return Auth.role() === 'score_inputter'; },

  isSuperAdmin()   { return Auth.role() === 'super_admin'; },
  isAdmin()        { return Auth.isSuperAdmin() || Auth.role() === 'tournament_admin'; },

  // A score inputter's tournament assignments (ignored for other roles).
  assignedTournaments() { return Auth.user()?.assigned_tournaments ?? []; },

  // tournamentId is required for score_inputter; admins can enter scores
  // anywhere so it's optional for them.
  canEnterScores(tournamentId) {
    if (Auth.isAdmin()) return true;
    if (Auth.isScoreInputter()) return Auth.assignedTournaments().includes(tournamentId);
    return false;
  },

  // Any logged-in user can favourite — fan, score inputter, or admin.
  canFavourite()   { return pb.authStore.isValid; },

  logout() {
    Logger.info('Auth.logout');
    pb.authStore.clear();
    window.location.href = 'login.html';
  },
};
