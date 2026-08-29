/**
 * =============================================================================
 * config.js — Configuration & global helpers
 * =============================================================================
 */

const CONFIG = {
  // The frontend is always served BY the same PocketBase instance that serves
  // the API, so it's always same-origin — no hardcoded host/port needed.
  // This also makes it work correctly behind Nginx regardless of public port.
  API_BASE_URL : window.location.origin,
  VERSION : '5.1.0',
};

/**
 * Escape a string for safe HTML insertion.
 * Defined here so all other modules can use it — loaded first.
 */
function escHtml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}
document.addEventListener("DOMContentLoaded", () => {
      const currentPath = window.location.pathname;
      const navLinks = document.querySelectorAll('.nav-link, .bottom-nav-item');

      navLinks.forEach(link => {
        const linkHref = link.getAttribute('href');
        
        // Clear previous active states first to see the change
        link.classList.remove('active');

        if ((currentPath === '/' || currentPath.endsWith('index.html')) && linkHref === 'index.html') {
          link.classList.add('active');
        } 
        else if (linkHref && currentPath.includes(linkHref) && linkHref !== 'index.html') {
          link.classList.add('active');
        }
      });
      
});

/**
 * Team display — short name primary, full name as a hover tooltip.
 * `team` is an expanded team record from `teams` (fixture.expand.home_team
 * / away_team), itself expanding master_team — fixture queries now request
 * `home_team.master_team,away_team.master_team` for this to be populated.
 * Falls back to the full name when no short_name is set.
 */
function teamDisplayHtml(team) {
  if (!team) return 'TBD';
  const fullName  = team.name || 'TBD';
  const shortName = team.expand?.master_team?.short_name;
  if (!shortName || shortName === fullName) return escHtml(fullName);
  return `<span title="${escHtml(fullName)}">${escHtml(shortName)}</span>`;
}

// Plain-text variant, for SVG text nodes / non-innerHTML contexts.
function teamDisplayName(team) {
  if (!team) return 'TBD';
  return team.expand?.master_team?.short_name || team.name || 'TBD';
}

// Header-only tag naming the tournament/event a category belongs to.
// Empty for a standalone category with no event_name — nothing to
// disambiguate against.
function tournamentTagHtml(tournament) {
  if (!tournament?.event_name) return '';
  return `<span class="tournament-tag">${escHtml(tournament.event_name)}</span>`;
}
