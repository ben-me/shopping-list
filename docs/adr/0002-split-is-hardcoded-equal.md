# 0002 - Split is hardcoded to equal; no splitRule field on the List

The MVP's only split is equal (total divided evenly across Members) and it is hardcoded in the Owed calculation. There is exactly one rule and it is always in effect, so carrying a `splitRule` identifier on the List would be state that can only ever hold a single value. An earlier draft of this decision kept the field on the schema for forward compatibility; it was dropped before the schema shipped. If a second split rule ever arrives, adding a column then is a straightforward migration.
