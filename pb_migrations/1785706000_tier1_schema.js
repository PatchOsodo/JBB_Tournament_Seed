/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // ---------------------------------------------------------------------
  // users — add username as a second login identity, for score collectors
  // who want a simpler login than email.
  // ---------------------------------------------------------------------
  const users = app.findCollectionByNameOrId("_pb_users_auth_")

  users.fields.add(new Field({
    "hidden": false,
    "id": "text3819742501",
    "max": 0,
    "min": 0,
    "name": "username",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  users.indexes = [
    ...users.indexes,
    "CREATE UNIQUE INDEX `idx_username__pb_users_auth_` ON `users` (`username`) WHERE `username` != ''"
  ]

  // Email OR username can now be used to log in.
  users.passwordAuth.identityFields = ["email", "username"]

  // SECURITY FIX while touching this rule anyway: previously createRule was
  // "" (wide open) with no check on WHICH role a self-registering anonymous
  // user could set — meaning anyone could POST role:"super_admin" directly
  // to the API and self-elevate, bypassing the client UI's hardcoded
  // role:'fan'. Now: anonymous signups are only allowed if role = "fan".
  // Admins (super_admin/tournament_admin) can still create a user with any
  // role, which is what the new "create score inputter" screen needs.
  users.createRule = `(@request.auth.id = "" && @request.body.role = "fan") || (@request.auth.id != "" && (@request.auth.role = "super_admin" || @request.auth.role = "tournament_admin"))`

  app.save(users)

  // ---------------------------------------------------------------------
  // tournaments — event_series / event_edition were already being SENT by
  // the client on every tournament creation, and event_series was already
  // being READ back for event-grouping logic (app.js line ~480) — but
  // neither field existed in the schema, so both were silently no-ops.
  // ---------------------------------------------------------------------
  const tournaments = app.findCollectionByNameOrId("pbc_340646327")
  tournaments.fields.add(new Field({
    "hidden": false, "max": 0, "min": 0, "name": "event_series",
    "pattern": "", "presentable": false, "primaryKey": false,
    "required": false, "system": false, "type": "text",
    "id": "text2984710365"
  }))
  tournaments.fields.add(new Field({
    "hidden": false, "max": 0, "min": 0, "name": "event_edition",
    "pattern": "", "presentable": false, "primaryKey": false,
    "required": false, "system": false, "type": "text",
    "id": "text2984710366"
  }))
  app.save(tournaments)

  // ---------------------------------------------------------------------
  // fixtures — lightweight manual venue/time tagging (Tier 1 stopgap, per
  // the roadmap doc's own guidance: ship the display/tagging now, before
  // the full venues_courts + auto-scheduling system in Tier 2).
  // ---------------------------------------------------------------------
  const fixtures = app.findCollectionByNameOrId("pbc_485997869")
  fixtures.fields.add(new Field({
    "hidden": false, "max": 0, "min": 0, "name": "scheduled_time",
    "pattern": "", "presentable": false, "primaryKey": false,
    "required": false, "system": false, "type": "text",
    "id": "text2984710367"
  }))
  fixtures.fields.add(new Field({
    "hidden": false, "max": 0, "min": 0, "name": "court_label",
    "pattern": "", "presentable": false, "primaryKey": false,
    "required": false, "system": false, "type": "text",
    "id": "text2984710368"
  }))
  return app.save(fixtures)
}, (app) => {
  const fixtures = app.findCollectionByNameOrId("pbc_485997869")
  fixtures.fields.removeById("text2984710367")
  fixtures.fields.removeById("text2984710368")
  app.save(fixtures)

  const tournaments = app.findCollectionByNameOrId("pbc_340646327")
  tournaments.fields.removeById("text2984710365")
  tournaments.fields.removeById("text2984710366")
  app.save(tournaments)

  const users = app.findCollectionByNameOrId("_pb_users_auth_")
  users.createRule = ``
  users.passwordAuth.identityFields = ["email"]
  users.fields.removeById("text3819742501")
  return app.save(users)
})
