/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const users = app.findCollectionByNameOrId("_pb_users_auth_")

  // update field — role values: 'guest' retired, 'fan' + 'score_inputter' added.
  // NOTE: anonymous (not-logged-in) visitors are "Guest" in the new naming —
  // that tier has no stored role value at all, since it has no user record.
  users.fields.addAt(8, new Field({
    "help": "",
    "hidden": false,
    "id": "select1466534506",
    "maxSelect": 0,
    "name": "role",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "select",
    "values": [
      "super_admin",
      "tournament_admin",
      "score_inputter",
      "fan"
    ]
  }))

  // new field — which tournaments a score_inputter may enter scores for.
  // Irrelevant/ignored for other roles.
  users.fields.add(new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_340646327",
    "help": "Only relevant for the score_inputter role — the tournaments this user is allowed to enter scores for.",
    "hidden": false,
    "id": "relation4041882217",
    "maxSelect": 999,
    "minSelect": 0,
    "name": "assigned_tournaments",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  app.save(users)

  // tighten fixtures.updateRule — previously ANY authenticated user with ANY
  // role could update fixtures (i.e. enter/edit scores). Now: super_admin and
  // tournament_admin always can; score_inputter only for tournaments they're
  // assigned to; fan cannot.
  const fixtures = app.findCollectionByNameOrId("pbc_485997869")
  fixtures.updateRule = `@request.auth.id != "" && (@request.auth.role = "super_admin" || @request.auth.role = "tournament_admin" || (@request.auth.role = "score_inputter" && tournament.id ?= @request.auth.assigned_tournaments.id))`
  return app.save(fixtures)
}, (app) => {
  const fixtures = app.findCollectionByNameOrId("pbc_485997869")
  fixtures.updateRule = `@request.auth.id != "" && @request.auth.role != ""`
  app.save(fixtures)

  const users = app.findCollectionByNameOrId("_pb_users_auth_")
  users.fields.removeById("relation4041882217")
  users.fields.addAt(8, new Field({
    "help": "",
    "hidden": false,
    "id": "select1466534506",
    "maxSelect": 0,
    "name": "role",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "select",
    "values": [
      "super_admin",
      "tournament_admin",
      "guest"
    ]
  }))
  return app.save(users)
})
