/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Group-stage pool size was previously a hardcoded heuristic inside
  // genGroupStage() with no admin control at all (2 pools under 9 teams,
  // 3 under 13, 4 otherwise). This field lets an admin choose teams-per-
  // pool directly; genGroupStage() now derives the pool count from it
  // instead of guessing.
  const tournaments = app.findCollectionByNameOrId("pbc_340646327")
  tournaments.fields.add(new Field({
    "hidden": false, "max": 32, "min": 2, "name": "teams_per_pool",
    "onlyInt": true, "presentable": false, "required": false,
    "system": false, "type": "number",
    "id": "number_tournaments_teamsperpool"
  }))
  return app.save(tournaments)
}, (app) => {
  const tournaments = app.findCollectionByNameOrId("pbc_340646327")
  tournaments.fields.removeById("number_tournaments_teamsperpool")
  return app.save(tournaments)
})
