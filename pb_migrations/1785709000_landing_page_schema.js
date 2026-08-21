/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // ---------------------------------------------------------------------
  // tournaments — gender/age_group/team-count were already being collected
  // in the setup wizard (used only as a default applied to each team, or
  // purely for the setup UI's own rendering) but never actually saved on
  // the tournament record itself. Adding the real fields here closes that
  // gap, same class of issue as event_series/event_edition earlier.
  // ---------------------------------------------------------------------
  const tournaments = app.findCollectionByNameOrId("pbc_340646327")

  tournaments.fields.add(new Field({
    "hidden": false, "name": "gender", "presentable": false,
    "required": false, "system": false, "type": "select",
    "id": "select_tournaments_gender", "maxSelect": 1,
    "values": ["Boys", "Girls", "Mixed", "Men", "Women"]
  }))
  tournaments.fields.add(new Field({
    "hidden": false, "max": 0, "min": 0, "name": "age_group",
    "pattern": "", "presentable": false, "primaryKey": false,
    "required": false, "system": false, "type": "text",
    "id": "text_tournaments_agegroup"
  }))
  tournaments.fields.add(new Field({
    "hidden": false, "max": 32, "min": 3, "name": "max_teams",
    "onlyInt": true, "presentable": false, "required": false,
    "system": false, "type": "number",
    "id": "number_tournaments_maxteams"
  }))
  tournaments.fields.add(new Field({
    "hidden": false, "maxSelect": 1, "maxSize": 5242880,
    "mimeTypes": ["image/jpeg", "image/png", "image/webp"],
    "name": "banner_image", "presentable": false, "protected": false,
    "required": false, "system": false, "thumbs": ["800x300"],
    "type": "file", "id": "file_tournaments_banner"
  }))
  app.save(tournaments)

  // ---------------------------------------------------------------------
  // master_teams.gender — the live taxonomy the roadmap doc found includes
  // Men/Women, not just Boys/Girls/Mixed. Widening to match, and matching
  // what tournaments.gender above now uses too.
  // ---------------------------------------------------------------------
  const masterTeams = app.findCollectionByNameOrId("pbc_4112452239")
  for (const f of masterTeams.fields) {
    if (f.name === "gender") {
      f.values = ["Boys", "Girls", "Mixed", "Men", "Women"]
    }
  }
  return app.save(masterTeams)
}, (app) => {
  const masterTeams = app.findCollectionByNameOrId("pbc_4112452239")
  for (const f of masterTeams.fields) {
    if (f.name === "gender") {
      f.values = ["Boys", "Girls", "Mixed"]
    }
  }
  app.save(masterTeams)

  const tournaments = app.findCollectionByNameOrId("pbc_340646327")
  tournaments.fields.removeById("select_tournaments_gender")
  tournaments.fields.removeById("text_tournaments_agegroup")
  tournaments.fields.removeById("number_tournaments_maxteams")
  tournaments.fields.removeById("file_tournaments_banner")
  return app.save(tournaments)
})
