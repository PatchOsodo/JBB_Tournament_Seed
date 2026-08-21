/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // ---------------------------------------------------------------------
  // master_teams becomes pure identity — name (+ optional club/short
  // name/home court). No gender, no age group. A team's category is now
  // determined entirely by which tournament its `teams` link points at
  // (every tournament already IS one category, since gender/age_group
  // live there) — never by anything stored on the master record itself.
  // This is what makes a U16 Girls team ending up in U19 Boys structurally
  // impossible: there's no field to mismatch anymore.
  //
  // NOTE: this deletes whatever gender/age_group values currently exist on
  // master_teams rows. This does NOT affect any team's actual category in
  // any tournament they're already entered in — that was always driven by
  // the tournament they're linked to, never by these fields.
  // ---------------------------------------------------------------------
  const masterTeams = app.findCollectionByNameOrId("pbc_4112452239")

  masterTeams.fields.removeById("select3343321666") // gender
  masterTeams.fields.removeById("text4169876051")   // age_group

  return app.save(masterTeams)
}, (app) => {
  const masterTeams = app.findCollectionByNameOrId("pbc_4112452239")

  masterTeams.fields.add(new Field({
    "hidden": false, "name": "gender", "presentable": false,
    "required": false, "system": false, "type": "select",
    "id": "select_masterteams_gender_restore", "maxSelect": 1,
    "values": ["Boys", "Girls", "Mixed", "Men", "Women"]
  }))
  masterTeams.fields.add(new Field({
    "hidden": false, "max": 0, "min": 0, "name": "age_group",
    "pattern": "", "presentable": false, "primaryKey": false,
    "required": false, "system": false, "type": "text",
    "id": "text_masterteams_agegroup_restore"
  }))

  return app.save(masterTeams)
})
