/**
 * =============================================================================
 * events.js — Shared event-grouping helpers
 *
 * A "tournament" record (the `tournaments` collection) is really one
 * CATEGORY (e.g. "U16 Boys"). Several category records sharing the same
 * event_name together make up one user-facing "event" (e.g. "JBB 9.0" with
 * U13/U16/U19 categories). There is no separate `events` collection — an
 * event is purely a derived grouping over `tournaments.event_name`.
 *
 * This logic previously existed as two separate, near-identical
 * implementations:
 *   - App._groupEventsByName / App._sortGroupsByRelevance (app.js)
 *   - TournamentsPage._buildGroups / TournamentsPage._makeGroup (tournaments.js)
 * Both are now thin callers of this single shared module, so the homepage
 * and the /tournaments directory can never disagree about what "the same
 * event" means or which category is "most relevant" within it.
 *
 * Depends on: nothing — pure functions over plain tournament records.
 * =============================================================================
 */

const Events = {

  // Age-group display/sort order, shared wherever a group's categories are
  // listed. Was previously a local const duplicated in tournaments.js.
  AGE_ORDER: ['U10', 'U12', 'U13', 'U14', 'U16', 'U19', 'Senior', 'Open'],

  /**
   * Groups a flat list of tournament(=category) records by event_name.
   * A record with no event_name becomes its own single-record group,
   * keyed by its own id so it never collides with a real event name.
   *
   * @param {Array<Object>} tournamentList
   * @returns {Object} { [key]: Array<tournament> }
   */
  groupByEventName(tournamentList) {
    const groups = {};
    (tournamentList || []).forEach(t => {
      const key = (t.event_name || '').trim() || t.id;
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    return groups;
  },

  /**
   * Sorts the object returned by groupByEventName() into an array of
   * [key, tournaments[]] entries — largest event first, ties broken by
   * most-recently-updated category within the group. This is the single
   * definition of "most relevant event," used by the homepage's featured-
   * tournament card and its "also happening now" rail.
   *
   * @param {Object} groups — output of groupByEventName()
   * @returns {Array<[string, Array<Object>]>}
   */
  sortGroupsByRelevance(groups) {
    return Object.entries(groups).sort((a, b) => {
      if (b[1].length !== a[1].length) return b[1].length - a[1].length;
      const aLatest = Math.max(...a[1].map(t => new Date(t.updated).getTime()));
      const bLatest = Math.max(...b[1].map(t => new Date(t.updated).getTime()));
      return bLatest - aLatest;
    });
  },

  /**
   * Derives display-ready summary fields for one event group — status,
   * age-group badges, aggregate team count, which category's banner to
   * show, and which single category a "View Tournament" link should
   * target until a real event-overview page exists (active > pending >
   * completed, most-current category wins).
   *
   * @param {string} displayName
   * @param {Array<Object>} tournamentsInGroup
   * @param {Object} teamCounts — { [tournamentId]: number }
   */
  summarize(displayName, tournamentsInGroup, teamCounts) {
    const allDone   = tournamentsInGroup.every(t => t.status === 'completed');
    const anyActive = tournamentsInGroup.some(t => t.status === 'active');
    const status    = allDone ? 'completed' : anyActive ? 'active' : 'pending';

    const ageGroups = [...new Set(tournamentsInGroup.map(t => t.age_group).filter(Boolean))]
      .sort((a, b) => Events.AGE_ORDER.indexOf(a) - Events.AGE_ORDER.indexOf(b));

    const teamCount = tournamentsInGroup.reduce(
      (sum, t) => sum + ((teamCounts && teamCounts[t.id]) || 0), 0
    );

    const bannerOwner = tournamentsInGroup.find(t => t.banner_image) || null;

    const priority = { active: 0, pending: 1, completed: 2 };
    const linkTarget = [...tournamentsInGroup].sort(
      (a, b) => (priority[a.status] ?? 3) - (priority[b.status] ?? 3)
    )[0];

    const latestUpdated = Math.max(...tournamentsInGroup.map(t => new Date(t.updated).getTime()));

    return {
      displayName,
      status,
      ageGroups,
      teamCount,
      categoryCount : tournamentsInGroup.length,
      bannerOwner,
      linkId        : linkTarget.id,
      latestUpdated,
      tournaments   : tournamentsInGroup,
    };
  },

  /**
   * Convenience wrapper: group + summarize in one call, sorted by most
   * recently updated event first. This is what the /tournaments directory
   * card grid uses.
   *
   * @param {Array<Object>} tournamentList
   * @param {Object} teamCounts
   */
  buildSummarizedGroups(tournamentList, teamCounts) {
    const groups = Events.groupByEventName(tournamentList);
    const summarized = Object.entries(groups).map(([, cats]) =>
      Events.summarize(cats[0].event_name || cats[0].name, cats, teamCounts)
    );
    summarized.sort((a, b) => b.latestUpdated - a.latestUpdated);
    return summarized;
  },

};
