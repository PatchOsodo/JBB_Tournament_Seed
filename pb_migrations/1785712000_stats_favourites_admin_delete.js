/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // team_stats.deleteRule was null (system-superuser-only) — meaning not
  // even our app-level super_admin role could delete a stats record via
  // the API. Needed for tournament-deletion cleanup (team_stats doesn't
  // cascade-delete with its tournament) to actually work.
  const teamStats = app.findCollectionByNameOrId("pbc_1861295738")
  teamStats.deleteRule = `@request.auth.id != "" && (@request.auth.role = "super_admin" || @request.auth.role = "tournament_admin")`
  app.save(teamStats)

  // favourites.deleteRule only allowed a user to delete their OWN
  // favourite. Widened so an admin can also clean up favourites pointing
  // at a tournament they're deleting, in addition to self-delete still
  // working exactly as before.
  const favourites = app.findCollectionByNameOrId("pbc_2176316817")
  favourites.deleteRule = `@request.auth.id != "" && (user = @request.auth.id || @request.auth.role = "super_admin" || @request.auth.role = "tournament_admin")`
  return app.save(favourites)
}, (app) => {
  const favourites = app.findCollectionByNameOrId("pbc_2176316817")
  favourites.deleteRule = `@request.auth.id != "" && user = @request.auth.id`
  app.save(favourites)

  const teamStats = app.findCollectionByNameOrId("pbc_1861295738")
  teamStats.deleteRule = null
  return app.save(teamStats)
})
