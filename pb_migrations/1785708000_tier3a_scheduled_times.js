/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // ---------------------------------------------------------------------
  // fixtures — real scheduling fields, additive to Tier 1's free-text
  // scheduled_time/court_label (which stay as-is, no data loss for anyone
  // already using them). These two new fields are the source of truth for
  // the Courts page's conflict-warning logic going forward.
  //
  // Deliberately NOT built: an auto-slotting algorithm, or an enforced rest
  // buffer — per confirmed decision, this is manual admin placement with
  // non-blocking warnings only.
  // ---------------------------------------------------------------------
  const fixtures = app.findCollectionByNameOrId("pbc_485997869")

  fixtures.fields.add(new Field({
    "hidden": false,
    "id": "date_fixtures_start",
    "name": "scheduled_start_time",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  fixtures.fields.add(new Field({
    "hidden": false,
    "id": "number_fixtures_duration",
    "max": null,
    "min": 1,
    "name": "estimated_duration_minutes",
    "onlyInt": true,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(fixtures)
}, (app) => {
  const fixtures = app.findCollectionByNameOrId("pbc_485997869")
  fixtures.fields.removeById("date_fixtures_start")
  fixtures.fields.removeById("number_fixtures_duration")
  return app.save(fixtures)
})
