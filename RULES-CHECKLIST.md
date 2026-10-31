# Rules checklist

Use this after publishing `firestore.rules`. You need three accounts:
- **A**: the owner, who creates the shop
- **B**: invited as a manager
- **C**: invited as an employee, limited to one branch
- **D**: a signed-in account that is not a member

You can test by hand in the app, or in the Firebase console under *Firestore → Rules → Rules Playground*. In the Playground, tick "Authenticated" and paste the user's UID from *Authentication → Users*.

✅ means allowed, ⛔ means it must be refused.

## Profiles (`users/{uid}`)
- ✅ A reads and updates their own profile (language, digits, name).
- ⛔ A reads B's profile.
- ⛔ A changes the `email` field of their own profile.

## Shops
- ✅ A creates a shop. The shop, the owner membership, the first branch and the profile update all succeed together.
- ⛔ D reads `shops/{A's shop}`.
- ⛔ D creates `shops/{id}/members/{D}` with role `owner` for A's existing shop.
- ⛔ B or C update the shop document (only the owner can).
- ✅ A updates the shop's name.

## Invites
- ✅ A creates an invite (Team → Invite someone). Both `shops/{id}/invites/{code}` and `inviteCodes/{code}` appear.
- ⛔ B (manager) creates an invite.
- ⛔ D lists `inviteCodes` or `shops/{id}/invites` (a list query). Reading one invite by its exact code is allowed on purpose.
- ✅ B joins with the code. The invite is marked `usedBy = B`.
- ⛔ B joins with a role other than the one on the invite, e.g. changes `role` to `owner` in the Playground.
- ⛔ D uses an invite that was already used (the app says "already used").
- ⛔ Anyone joins with an expired invite. To test, set `expiresAt` to a past date by hand in the console, as the console isn't bound by the rules.
- ✅ A cancels a pending invite. The code then shows "not valid".

## Members and roles
- ✅ A changes C's role, locations and "can see costs", and disables C.
- ⛔ A changes their own role or disables themselves.
- ⛔ A sets C's role to `owner`.
- ⛔ A saves C as an employee with no location.
- ⛔ B (manager) changes C's role or disables C.
- ✅ B reads the member list. ⛔ C (employee) reads the member list.
- ✅ C reads their own membership while disabled, and sees "Your access to this shop is disabled".
- ⛔ C, while disabled, reads the shop or its locations.
- ✅ After A enables C again, C's shop opens within a few seconds without signing out.
- ✅ A removes C. C's shop disappears from C's list.

## Locations
- ✅ A and B add and edit branches and warehouses.
- ⛔ C adds or edits a location.
- ⛔ B deletes a location (only the owner can).
- ✅ A deletes a location after typing the confirmation word.
