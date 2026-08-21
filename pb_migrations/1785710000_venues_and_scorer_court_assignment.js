/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // ---------------------------------------------------------------------
  // venues — sits above venues_courts. "Add venue, pick a court count"
  // instead of adding courts one at a time. court_count is stored for
  // display/reference; the actual courts are still individual
  // venues_courts records (Court 1, Court 2, ...) generated when the venue
  // is created, so fixtures.court keeps pointing at real court records —
  // no change needed to the fixtures side of things.
  // ---------------------------------------------------------------------
  const venues = new Collection({
    "createRule": `@request.auth.id != "" && (@request.auth.role = "super_admin" || @request.auth.role = "tournament_admin")`,
    "deleteRule": `@request.auth.id != "" && (@request.auth.role = "super_admin" || @request.auth.role = "tournament_admin")`,
    "updateRule": `@request.auth.id != "" && (@request.auth.role = "super_admin" || @request.auth.role = "tournament_admin")`,
    "listRule": "",
    "viewRule": "",
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}", "hidden": false,
        "id": "text_venues_id", "max": 15, "min": 15, "name": "id",
        "pattern": "^[a-z0-9]+$", "presentable": false, "primaryKey": true,
        "required": true, "system": true, "type": "text"
      },
      {
        "cascadeDelete": true, "collectionId": "pbc_340646327",
        "hidden": false, "id": "relation_venues_tournament",
        "maxSelect": 1, "minSelect": 1, "name": "tournament",
        "presentable": false, "required": true, "system": false,
        "type": "relation"
      },
      {
        "hidden": false, "id": "text_venues_name", "max": 80, "min": 1,
        "name": "venue_name", "pattern": "", "presentable": false,
        "primaryKey": false, "required": true, "system": false,
        "type": "text"
      },
      {
        "hidden": false, "id": "number_venues_courtcount", "max": 20,
        "min": 1, "name": "court_count", "onlyInt": true,
        "presentable": false, "required": true, "system": false,
        "type": "number"
      },
      {
        "hidden": false, "id": "autodate_venues_created", "name": "created",
        "onCreate": true, "onUpdate": false, "presentable": false,
        "system": false, "type": "autodate"
      },
      {
        "hidden": false, "id": "autodate_venues_updated", "name": "updated",
        "onCreate": true, "onUpdate": true, "presentable": false,
        "system": false, "type": "autodate"
      }
    ],
    "id": "pbc_6198427103",
    "indexes": [],
    "name": "venues",
    "system": false,
    "type": "base"
  })
  app.save(venues)

  // ---------------------------------------------------------------------
  // venues_courts — add an optional `venue` relation. Optional (not
  // required) so any court already created directly (pre-venues) keeps
  // working untouched, matching the additive pattern used throughout this
  // project rather than a breaking migration.
  // ---------------------------------------------------------------------
  const courts = app.findCollectionByNameOrId("pbc_5233819402")
  courts.fields.add(new Field({
    "cascadeDelete": true,
    "collectionId": "pbc_6198427103",
    "hidden": false,
    "id": "relation_courts_venue",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "venue",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  // ---------------------------------------------------------------------
  // fixtures.updateRule already allows a score_inputter to update ANY
  // field on a fixture in their assigned tournament (including `court`) —
  // confirmed by re-reading the existing rule from migration 1785704900.
  // No rule change needed here; the gap was purely that the score-entry
  // UI never exposed a court picker to anyone but admins on the Courts
  // page. That's a frontend fix, not a schema/rule fix.
  // ---------------------------------------------------------------------
  return app.save(courts)
}, (app) => {
  const courts = app.findCollectionByNameOrId("pbc_5233819402")
  courts.fields.removeById("relation_courts_venue")
  app.save(courts)

  const venues = app.findCollectionByNameOrId("pbc_6198427103")
  return app.delete(venues)
})
