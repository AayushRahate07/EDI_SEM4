# CHANGES.md — Full Development Log

> This document records every feature added, bug fixed, and architectural decision made during the EDI Sem 4 development session with Team Vollab.  
> Changes are grouped by area and ordered chronologically.

---

## Table of Contents

- [Phase 1 — Bug Fixes (API Contract & Logic)](#phase-1--bug-fixes-api-contract--logic)
- [Phase 2 — Inventory System (Backend)](#phase-2--inventory-system-backend)
- [Phase 3 — Inventory System (Frontend)](#phase-3--inventory-system-frontend)
- [Phase 4 — NFC Hardware Bridge](#phase-4--nfc-hardware-bridge)
- [Phase 5 — Scan-to-Fill & UX Polish](#phase-5--scan-to-fill--ux-polish)
- [Phase 6 — Bug Audit & Hardening](#phase-6--bug-audit--hardening)
- [Phase 7 — GitHub & Cross-Device Readiness](#phase-7--github--cross-device-readiness)
- [Phase 8 — Documentation](#phase-8--documentation)

---

## Phase 1 — Bug Fixes (API Contract & Logic)

These were pre-existing bugs that prevented the frontend and backend from communicating correctly.

### 1.1 — `transitions` vs `next_nodes` Mismatch (CRITICAL)

**File:** `sop-interface/components/SopBuilder.tsx` → `compile()` function

**Problem:** The frontend was building edges as an array of objects called `transitions`:
```json
{ "transitions": [{ "target_node_id": "step_123", "condition": "DEFAULT" }] }
```
The backend Zod schema (`sop.schema.ts`) strictly expected an array of strings called `next_nodes`:
```json
{ "next_nodes": ["step_123"] }
```
This caused every single "Validate & Save" click to return a `400 Bad Request`.

**Fix:** Rewrote the `compile()` function to build `next_nodes` as a flat array of target node ID strings, matching the Zod schema exactly.

---

### 1.2 — Field Naming Mismatches in Node Config (CRITICAL)

**File:** `sop-interface/components/SopBuilder.tsx` → `compile()`

**Problem:** The frontend was sending camelCase field names, but the Zod schema expected snake_case:

| Frontend sent | Backend expected |
|---------------|-----------------|
| `expectedEntity` | `entity_name` |
| `tolerancePositive` | `tolerance_positive` |
| `toleranceNegative` | `tolerance_negative` |

**Fix:** Updated the `compile()` serialization to use the correct snake_case keys.

---

### 1.3 — Wrong Start Node Detection Logic (CRITICAL)

**File:** `sop-interface/components/SopBuilder.tsx` → `compile()`

**Problem:** The code used `dag.nodes[0]` (first node in the array) as the start node. This was wrong because nodes are stored in creation order, not topological order. The real start node is the one with no incoming edges.

**Fix:** Replaced with edge-based root detection:
```typescript
// Find the node that has no incoming edges — that is the true start node
const nodeIdsWithIncoming = new Set(edges.map(e => e.to));
const startNode = nodes.find(n => !nodeIdsWithIncoming.has(n.id));
```

---

### 1.4 — Missing SVG Arrow Markers

**File:** `sop-interface/components/SopBuilder.tsx` → SVG canvas

**Problem:** Edge arrows were invisible because `<defs><marker>` was never rendered in the SVG. The `markerEnd` attribute was referencing an undefined marker ID.

**Fix:** Added `<defs>` block with `<marker>` definitions at the top of the SVG element.

---

### 1.5 — Backend Zod Validation: `parse` → `safeParse`

**File:** `sop-engine/src/sop.controller.ts`

**Problem:** The controller was using `SopDagSchema.parse(payload)` which throws a raw Zod error (not an HTTP exception). NestJS was returning a confusing `500 Internal Server Error` instead of a clean `400 Bad Request`.

**Fix:** Switched to `safeParse` + explicit `BadRequestException`:
```typescript
const parseResult = SopDagSchema.safeParse(payload);
if (!parseResult.success) {
  throw new BadRequestException({
    message: 'SOP payload validation failed',
    errors: parseResult.error.flatten().fieldErrors,
  });
}
```

---

### 1.6 — XState Actor Memory Leak

**File:** `sop-engine/src/api/workflow.controller.ts`

**Problem:** Each call to `GET /runs/:id/status` rehydrated an XState actor from the database snapshot but never stopped it. Over many requests, actors accumulated in memory indefinitely.

**Fix:** Added `actor.stop()` after extracting the snapshot:
```typescript
const snapshot = actor.getSnapshot();
actor.stop(); // ← prevents memory leak
return { state: snapshot.value, ... };
```

---

### 1.7 — Prisma v7 Schema Compatibility

**File:** `sop-engine/prisma/schema.prisma`

**Problem:** Prisma v7 no longer supports the `url` field inside `datasource db {}` in `schema.prisma`. The DB URL must live in `prisma.config.ts` instead.

**Fix:** Removed the `url` field from `schema.prisma`. The datasource config was already correctly set in `prisma.config.ts`:
```typescript
export default defineConfig({
  datasource: { url: 'file:./prisma/dev.db' }
});
```

---

### 1.8 — PrismaService Import Error

**File:** `sop-engine/src/persistence/prisma.service.ts`

**Problem:** `PrismaClient` was imported from `@prisma/client` but with Prisma v7 + `better-sqlite3` adapter, the import path had changed. TypeScript was throwing `Module '@prisma/client' has no exported member 'PrismaClient'`.

**Fix:** Regenerated the Prisma client (`npx prisma generate`) and corrected the import to work with the v7 client export structure.

---

## Phase 2 — Inventory System (Backend)

### 2.1 — New Database Model: `InventoryItem`

**File:** `sop-engine/prisma/schema.prisma`

**Added:**
```prisma
model InventoryItem {
  id          String    @id @default(uuid())
  nfcUid      String    @unique @map("nfc_uid")
  name        String
  batchNo     String?   @map("batch_no")
  expiryDate  DateTime? @map("expiry_date")
  createdAt   DateTime  @default(now())

  @@map("inventory_items")
}
```

**Migration created:** `20260521194723_add_inventory_items`  
This creates the `inventory_items` table in SQLite with a unique index on `nfc_uid`.

---

### 2.2 — New Controller: `InventoryController`

**File:** `sop-engine/src/api/inventory.controller.ts` ← **NEW FILE**

Created with four endpoints:

#### `GET /api/inventory`
Returns all registered inventory items ordered by creation date (newest first). Used by the frontend canvas dropdown.

#### `POST /api/inventory/register`
Registers a new NFC-tagged item. Body: `{ nfcUid, name, batchNo?, expiryDate? }`. Returns `400` if `nfcUid` or `name` is missing. Stores `expiryDate` as a proper `DateTime`.

#### `POST /api/hardware/scan`
Called by the NFC bridge when a tag is scanned. Steps:
1. Normalises UID to uppercase
2. Stores it in module-level `lastScan` memory store
3. Looks up the item in the DB (using the uppercased UID)
4. Returns item + `status: 'ACTIVE' | 'EXPIRED'` + human-readable message

#### `GET /api/hardware/last-scan`
Returns `{ uid, timestamp }` of the most recently scanned tag. Used by the frontend to poll for auto-fill. Returns `{ uid: '', timestamp: 0 }` if nothing has been scanned yet.

---

### 2.3 — Controller Registered in AppModule

**File:** `sop-engine/src/app.module.ts`

Added import and registration:
```typescript
import { InventoryController } from './api/inventory.controller';

@Module({
  controllers: [WorkflowController, SopController, InventoryController, AppController],
})
```

---

## Phase 3 — Inventory System (Frontend)

### 3.1 — New Admin Page: `/admin/inventory`

**File:** `sop-interface/app/admin/inventory/page.tsx` ← **NEW FILE**

A form page for lab managers to register physical materials against NFC tags. Features:
- Polls `GET /api/hardware/last-scan` every 1.5 seconds
- Auto-fills the NFC UID field when a tag is detected
- Green "⚡ Tag Detected!" badge flashes for 2 seconds on auto-fill
- All styles are inline (`React.CSSProperties`) to prevent global CSS bleed-through from the SOP builder
- Success banner auto-clears after 4 seconds

**Fields:**
- NFC Tag UID (required, auto-fills from scan)
- Material Name (required)
- Batch Number (optional)
- Expiry Date (optional, date picker)

---

### 3.2 — Inventory Dropdown in SOP Canvas

**File:** `sop-interface/components/SopBuilder.tsx` — `Sidebar` component

**What changed:** The `VERIFICATION` node's "Expected Label" field was previously a free-text `<input type="text">`. It was replaced with a `<select>` dropdown that fetches registered inventory items on mount.

**New state variables added:**
```typescript
const [inventoryItems, setInventoryItems] = useState<{ id: string; name: string; nfcUid: string }[]>([]);
const [inventoryLoading, setInventoryLoading] = useState(false);
```

**New `useEffect` added:**
```typescript
useEffect(() => {
  setInventoryLoading(true);
  fetch("http://localhost:3000/api/inventory")
    .then(r => r.json())
    .then(data => setInventoryItems(Array.isArray(data) ? data : []))
    .catch(() => {}) // fails silently if backend offline
    .finally(() => setInventoryLoading(false));
}, []);
```

**Dropdown behaviour:**
- While loading: shows `"Loading inventory..."`
- If backend offline / empty: shows `"No items registered"`
- When loaded: shows `"-- Select from Inventory --"` + options formatted as `Item Name (NFC_UID)`
- Calling `onUpdateConfig` on change — no other pipeline logic changed

---

## Phase 4 — NFC Hardware Bridge

### 4.1 — New Service: `nfc-bridge`

**Files:** `nfc-bridge/index.js`, `nfc-bridge/package.json` ← **NEW FOLDER + FILES**

A standalone Node.js script that bridges the Arduino serial port to the REST API.

**Dependencies installed:**
- `serialport@13` — reads data from Arduino over USB-Serial
- `axios@1` — makes HTTP POST requests to the backend

**Core logic:**
1. Opens the serial port at `COM_PORT` (9600 baud)
2. Pipes through `ReadlineParser` (splits on `\n`)
3. On each line: runs regex `/([A-Fa-f0-9]{8,14})/` to extract hex UID
4. POSTs `{ uid }` to `/api/hardware/scan`
5. Logs the cloud response or error to console

**Fixed the original code's syntax error:** The provided code used `const { SerialPort } from 'serialport'` (ES module `import` syntax mixed with CommonJS `require`). Fixed to `const { SerialPort } = require('serialport')`.

---

## Phase 5 — Scan-to-Fill & UX Polish

### 5.1 — Port Correction in Admin Page

**File:** `sop-interface/app/admin/inventory/page.tsx`

Corrected the hardcoded fetch URL from port `3001` to `3000`:
```
http://localhost:3001/api/inventory/register  →  http://localhost:3000/api/inventory/register
```

---

### 5.2 — Backend: In-Memory Last-Scan Store

**File:** `sop-engine/src/api/inventory.controller.ts`

Added module-level store:
```typescript
let lastScan: { uid: string; timestamp: number } | null = null;
```

Modified `POST /api/hardware/scan` to always capture the UID **before** the DB lookup (so even unregistered tags get captured for auto-fill):
```typescript
lastScan = { uid: body.uid.toUpperCase(), timestamp: Date.now() };
```

Added new `GET /api/hardware/last-scan` endpoint that returns this store.

---

### 5.3 — Frontend: Scan-to-Fill Polling

**File:** `sop-interface/app/admin/inventory/page.tsx`

Added `useEffect` polling loop:
```typescript
useEffect(() => {
  const interval = setInterval(async () => {
    const data = await fetch("http://localhost:3000/api/hardware/last-scan").then(r => r.json());
    if (data.uid && data.timestamp > lastTimestampRef.current) {
      lastTimestampRef.current = data.timestamp;
      setFormData(prev => ({ ...prev, nfcUid: data.uid }));
      setScanning(true);
      setTimeout(() => setScanning(false), 2000);
    }
  }, 1500);
  return () => clearInterval(interval);
}, []);
```

Uses `lastTimestampRef` (a `useRef`) to track the last seen timestamp so the same scan never triggers twice.

---

### 5.4 — Admin Page: Full Inline Style Rewrite

**File:** `sop-interface/app/admin/inventory/page.tsx`

The page's Tailwind CSS classes were being overridden by the SOP Builder's global styles (causing orange label colours, wrong font sizes, etc.). Replaced all Tailwind classes with explicit `React.CSSProperties` inline style objects. Every colour, font size, and spacing value is now explicit and isolated.

---

## Phase 6 — Bug Audit & Hardening

A full neutral review of all new code. Bugs found and fixed:

### BUG-1 — UID Case Mismatch on DB Lookup (CRITICAL)

**File:** `sop-engine/src/api/inventory.controller.ts`

**Problem:** `lastScan.uid` was stored uppercased, but `findUnique` was using the raw `body.uid` (mixed case as sent by the bridge). If the bridge sent `7f29bbdd` but the DB stored `7F29BBDD`, the lookup returned a false 404.

**Fix:**
```typescript
lastScan = { uid: body.uid.toUpperCase(), timestamp: Date.now() };
const normalisedUid = lastScan.uid; // use uppercase for lookup
const item = await this.prisma.client.inventoryItem.findUnique({
  where: { nfcUid: normalisedUid }
});
```

---

### BUG-2 — Timestamp Reset Caused Immediate Re-fill (CRITICAL)

**File:** `sop-interface/app/admin/inventory/page.tsx`

**Problem:** After a successful registration, `lastTimestampRef.current` was reset to `0`. Since the Arduino broadcasts the same tag repeatedly (every ~1 second), the poller would immediately pick it up again and re-fill the now-cleared NFC UID field.

**Fix:** Reset to `Date.now()` instead of `0`:
```typescript
lastTimestampRef.current = Date.now(); // ignore already-seen scans after register
```

---

### BUG-3 — No Debounce in NFC Bridge (HIGH)

**File:** `nfc-bridge/index.js`

**Problem:** Each tag tap triggered 3–5 identical HTTP POST requests within 2 seconds (because the Arduino broadcasts the UID continuously while the tag is in range). This hammered the backend unnecessarily.

**Fix:** Added a per-UID 2-second cooldown map:
```javascript
const lastSentTime = {};
const DEBOUNCE_MS = 2000;

// Inside parser.on('data'):
const now = Date.now();
if (lastSentTime[uid] && now - lastSentTime[uid] < DEBOUNCE_MS) return;
lastSentTime[uid] = now;
```

---

### BUG-5 — Success Banner Never Clears (LOW)

**File:** `sop-interface/app/admin/inventory/page.tsx`

**Problem:** The green "✓ Item successfully linked to NFC Tag!" banner stayed on screen indefinitely after registering an item, making it confusing when registering multiple items in a row.

**Fix:** Auto-clear after 4 seconds:
```typescript
setStatus({ type: "success", message: "✓ Item successfully linked to NFC Tag!" });
setTimeout(() => setStatus({ type: "", message: "" }), 4000);
```

---

## Phase 7 — GitHub & Cross-Device Readiness

### 7.1 — `nfc-bridge` Had No `.gitignore`

**File:** `nfc-bridge/.gitignore` ← **NEW FILE**

`serialport` includes native C++ binary bindings compiled specifically for the current OS and Node.js version. These **cannot** be shared across machines. Without a `.gitignore`, the entire `node_modules/` folder (including native binaries) would be committed.

**Fix:** Created `nfc-bridge/.gitignore` containing `node_modules/`.

---

### 7.2 — `dev.db` Was Tracked by Git

**File:** `sop-engine/.gitignore` + `git rm --cached`

**Problem:** The SQLite database file `sop-engine/prisma/dev.db` was committed to git. This meant:
- Teammates would clone with pre-existing data (your local inventory items)
- Every time the DB changed, it showed up as a modified binary file in `git status`
- Merge conflicts on a binary file are unresolvable

**Fix:**
1. Added `prisma/*.db` and `prisma/*.db-journal` to `sop-engine/.gitignore`
2. Ran `git rm --cached sop-engine/prisma/dev.db` to stop tracking the existing file
3. The file remains on disk; it's just no longer committed

---

### 7.3 — `tsconfig.build.tsbuildinfo` Was Tracked

**Problem:** This is a TypeScript incremental compilation cache — it's machine-specific and causes merge conflicts.

**Fix:** Added `*.tsbuildinfo` to `sop-engine/.gitignore` + `git rm --cached`.

---

### 7.4 — `COM6` Hardcoded in Bridge

**File:** `nfc-bridge/index.js`

**Problem:** `COM6` is the port on one specific Windows laptop. On any other machine, the Arduino will be on a different port (`COM3`, `/dev/tty.usbmodem14101`, `/dev/ttyUSB0`, etc.), and the bridge would crash immediately.

**Fix:** Made configurable via environment variable with fallback:
```javascript
const PORT_NAME = process.env.COM_PORT || 'COM6';
const API_URL   = process.env.API_URL   || 'http://localhost:3000/api/hardware/scan';
```

---

### 7.5 — `nfc-bridge` Had No `start` Script

**File:** `nfc-bridge/package.json`

Added:
```json
"scripts": {
  "start": "node index.js"
}
```

---

### 7.6 — Outdated `setup.txt` Deleted

`setup.txt` contained rough scaffold notes (`nest new sop-engine`, `npm install dotenv`, etc.) from initial project creation. These were misleading for any teammate trying to set up the project from scratch.

**Fix:** `git rm setup.txt` — deleted from repo.

---

## Phase 8 — Documentation

### 8.1 — Root `README.md` — Full Rewrite

**File:** `README.md`

Replaced with a comprehensive guide including:
- Architecture ASCII diagram showing all 3 services
- Full tech stack table
- Prerequisites with version requirements
- Step-by-step first-time setup for all 3 services
- Daily workflow commands
- Complete API reference table
- Pages & routes reference
- Hardware data flow explanation
- Database model table
- Troubleshooting guide (6 common issues)

---

### 8.2 — `sop-engine/README.md` — Full Rewrite

**File:** `sop-engine/README.md`

Replaced NestJS boilerplate with:
- Setup commands (install, migrate, generate, start)
- Explanation of the DB migration workflow
- Key files table

---

### 8.3 — `sop-interface/README.md` — Full Rewrite

**File:** `sop-interface/README.md`

Replaced Next.js boilerplate with:
- Page descriptions (`/` canvas, `/admin/inventory`)
- `SopBuilder.tsx` component breakdown by line range
- API calls made by the frontend
- Compiled DAG JSON format example

---

### 8.4 — `nfc-bridge/README.md` — New File

**File:** `nfc-bridge/README.md` ← **NEW FILE**

New file covering:
- Data flow diagram (tag → Arduino → bridge → API → browser)
- Setup instructions
- Platform-specific port finding instructions
- Environment variables table
- Expected Arduino serial output format
- Sample console output with explanation
- Dependencies table

---

### 8.5 — `CHANGES.md` — This File

**File:** `CHANGES.md` ← **NEW FILE**

This document, recording every change in complete detail.

---

## Summary Statistics

| Category | Count |
|----------|-------|
| Critical bugs fixed | 5 |
| High severity bugs fixed | 2 |
| Low severity bugs fixed | 1 |
| New files created | 6 |
| Files significantly modified | 7 |
| Database migrations added | 1 |
| New API endpoints added | 4 |
| New frontend pages added | 1 |
| README files written | 4 |
