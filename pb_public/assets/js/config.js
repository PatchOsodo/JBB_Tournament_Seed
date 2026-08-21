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
