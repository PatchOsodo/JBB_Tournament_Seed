/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // ---------------------------------------------------------------------
  // venues_courts — scoped per-tournament, per the confirmed decision
  // (not shared at the event level). Simplified per the roadmap: no
  // scheduled times or slot indices yet, just "this court exists and is
  // active for this tournament."
  // ---------------------------------------------------------------------
  const courts = new Collection({
    "createRule": `@request.auth.id != "" && (@request.auth.role = "super_admin" || @request.auth.role = "tournament_admin")`,
    "deleteRule": `@request.auth.id != "" && (@request.auth.role = "super_admin" || @request.auth.role = "tournament_admin")`,
    "updateRule": `@request.auth.id != "" && (@request.auth.role = "super_admin" || @request.auth.role = "tournament_admin")`,
    "listRule": "",
    "viewRule": "",
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "hidden": false,
        "id": "text_courts_id",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "cascadeDelete": true,
        "collectionId": "pbc_340646327",
        "hidden": false,
        "id": "relation_courts_tournament",
        "maxSelect": 1,
        "minSelect": 1,
        "name": "tournament",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "hidden": false,
        "id": "text_courts_name",
        "max": 60,
        "min": 1,
        "name": "court_name",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "bool_courts_active",
        "name": "is_active",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "bool"
      },
      {
        "hidden": false, "id": "autodate_courts_created", "name": "created",
        "onCreate": true, "onUpdate": false, "presentable": false,
        "system": false, "type": "autodate"
      },
      {
        "hidden": false, "id": "autodate_courts_updated", "name": "updated",
        "onCreate": true, "onUpdate": true, "presentable": false,
        "system": false, "type": "autodate"
      }
    ],
    "id": "pbc_5233819402",
    "indexes": [],
    "name": "venues_courts",
    "system": false,
    "type": "base"
  })
  app.save(courts)

  // ---------------------------------------------------------------------
  // fixtures — add a court relation (single, optional). Deliberately
  // keeping the Tier 1 free-text court_label field too: it still works as
  // a manual override/fallback, but the new UI will default to picking
  // from a real court record instead of typing a name each time.
  // ---------------------------------------------------------------------
  const fixtures = app.findCollectionByNameOrId("pbc_485997869")
  fixtures.fields.add(new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_5233819402",
    "hidden": false,
    "id": "relation_fixtures_court",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "court",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))
  return app.save(fixtures)
}, (app) => {
  const fixtures = app.findCollectionByNameOrId("pbc_485997869")
  fixtures.fields.removeById("relation_fixtures_court")
  app.save(fixtures)

  const courts = app.findCollectionByNameOrId("pbc_5233819402")
  return app.delete(courts)
})
