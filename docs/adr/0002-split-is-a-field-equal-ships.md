# 0002 - Split is a schema field; MVP ships equal only

The MVP's only split is equal (total divided evenly across Members). But we recorded that as a **field on the List** rather than hardcoded math, because the product intent is that other splits (e.g. weighted by income or roommates eating a different share) will come later.

Why not just hardcode 50/50: equal is the only *implemented* rule but not the *only intended* one. Baking the division into the calculation would force a migration (new column + full recalculation of every list's standing) when a second rule arrives. Carrying a `splitRule` identifier now is nearly free and keeps the door open.

A future reader who sees only the equal math might assume equal was the whole intent; this records that it is a deliberate, forward-compatible default.