/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const users = app.findCollectionByNameOrId("_pb_users_auth_")

  // Previously "" (open to anyone, including anonymous) — any guest could
  // list every user's name and email. Restrict listing to admins only.
  users.listRule = `@request.auth.id != "" && (@request.auth.role = "super_admin" || @request.auth.role = "tournament_admin")`

  // Allow admins to view any user record, in addition to a user viewing their own.
  users.viewRule = `@request.auth.id = id || @request.auth.role = "super_admin" || @request.auth.role = "tournament_admin"`

  // Previously ONLY the user themself could update their own record — this
  // blocked admins from setting assigned_tournaments on someone else's
  // account. Allow admins to update any user, in addition to self-update.
  users.updateRule = `@request.auth.id = id || @request.auth.role = "super_admin" || @request.auth.role = "tournament_admin"`

  return app.save(users)
}, (app) => {
  const users = app.findCollectionByNameOrId("_pb_users_auth_")
  users.listRule = ``
  users.viewRule = `@request.auth.id = id`
  users.updateRule = `@request.auth.id = id`
  return app.save(users)
})
