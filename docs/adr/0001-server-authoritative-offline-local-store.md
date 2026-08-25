# 0001 - Server-authoritative, offline-capable local store

The Lists are shared and multi-user, but the app must keep working without wifi on smartphones using the last-synced data.

We chose: the client is a locally-first PWA — dexie.js holds a working copy on the device, so the user can add Items, tick them, and record Payments with no network. The device is *not* the source of truth; the server (hono + sqlite) is. When a device returns online it syncs by exchanging patches, and the server reconciles.

A deliberate consequence: sync **does not merge or dedupe**. If two members add the "same" Item offline, both copies persist. Buying-two-of-milk and both-recording-it are treated as two real events, not one to collapse. Payments are small, low-conflict records that reconcile on last-write-wins per field — a Member may edit their own Payment — and Item edits also converge on last-write-wins per field.

Chosen over device-authoritative sync (diverges across devices and needs conflict UI) because cross-device convergence is a hard requirement and this keeps a single authoritative store with a humble, predictable merge story.