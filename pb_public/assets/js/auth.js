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

  // Logged in, can enter/edit scores for ANY tournament — see canEnterScores().
  isScoreInputter(){ return Auth.role() === 'score_inputter'; },

  isSuperAdmin()   { return Auth.role() === 'super_admin'; },
  isAdmin()        { return Auth.isSuperAdmin() || Auth.role() === 'tournament_admin'; },

  // A score inputter's tournament assignments. No longer used by
  // canEnterScores() below (score_inputter now has universal access, see
  // migration 1785714000_score_inputter_universal_access.js) — left here
  // in case this list is reused for something else later (e.g. a "notify
  // these scorers" feature), since the underlying data still exists.
  assignedTournaments() { return Auth.user()?.assigned_tournaments ?? []; },

  // tournamentId kept in the signature for compatibility with existing
  // call sites (Auth.canEnterScores(fixture.tournament) etc.) — no longer
  // actually consulted for score_inputter, which now matches the
  // unconditional server-side fixtures.updateRule.
  canEnterScores(tournamentId) {
    if (Auth.isAdmin()) return true;
    if (Auth.isScoreInputter()) return true;
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
