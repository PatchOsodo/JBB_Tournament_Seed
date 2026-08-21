/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const tournaments = app.findCollectionByNameOrId("pbc_340646327")

  // new field — registration deadline. Empty/unset means "no lock" (legacy
  // tournaments created before this feature existed keep working as-is).
  tournaments.fields.add(new Field({
    "hidden": false,
    "id": "date3298104621",
    "name": "registration_deadline",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  // Previously: any authenticated user with ANY role could create/update/
  // delete tournaments. Tightened to admins only, and — the new part —
  // tournament_admin can only update once the registration deadline has
  // passed; super_admin can always update (this IS the force-unlock: a
  // super_admin editing the deadline forward reopens it for tournament_admin
  // too, no separate unlock flag needed).
  const adminOnly = `@request.auth.id != "" && (@request.auth.role = "super_admin" || @request.auth.role = "tournament_admin")`
  tournaments.createRule = adminOnly
  tournaments.deleteRule = adminOnly
  tournaments.updateRule = `@request.auth.id != "" && (@request.auth.role = "super_admin" || (@request.auth.role = "tournament_admin" && (registration_deadline = "" || registration_deadline > @now)))`

  app.save(tournaments)

  // teams: same admin-only tightening. createRule (adding a NEW team) also
  // gets the deadline gate, scoped to registration closing — updateRule/
  // deleteRule for teams already on the roster stay admin-only without the
  // gate, since editing an existing team isn't "registration."
  const teams = app.findCollectionByNameOrId("pbc_1568971955")
  teams.createRule = `@request.auth.id != "" && (@request.auth.role = "super_admin" || (@request.auth.role = "tournament_admin" && (tournament.registration_deadline = "" || tournament.registration_deadline > @now)))`
  teams.updateRule = adminOnly
  teams.deleteRule = adminOnly

  return app.save(teams)
}, (app) => {
  const teams = app.findCollectionByNameOrId("pbc_1568971955")
  const oldRule = `@request.auth.id != "" && @request.auth.role != ""`
  teams.createRule = oldRule
  teams.updateRule = oldRule
  teams.deleteRule = oldRule
  app.save(teams)

  const tournaments = app.findCollectionByNameOrId("pbc_340646327")
  tournaments.createRule = oldRule
  tournaments.updateRule = oldRule
  tournaments.deleteRule = oldRule
  tournaments.fields.removeById("date3298104621")
  return app.save(tournaments)
})
