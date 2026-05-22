# Kaushal's Changes — Post-Pull Integration & Feature Work

> **Branch**: `EDI_SEM4` — post-merge with Krishna's hardware changes
> **Period**: May 2026 (Session 2 onwards)

---

## Overview

After pulling Krishna's NFC/hardware code into the repository, the base workflow engine and dashboard code were found to be broken/reverted. This document records all restoration work, new features, bug fixes, and architectural decisions made to bring the system to a fully working state.

---

## 1. Engine Restoration (`sop-engine`)

### `src/engine/workflow.compiler.ts`
- Restored full `WorkflowContext` type with `YoloState` and `WeightState` fields
- Added global `YOLO_UPDATE` and `WEIGHT_UPDATE` event listeners to the XState machine so live sensor data is absorbed into the workflow context in real time
- Fixed `compile()` function to correctly build the XState config from stored SOP node/edge definitions

### `src/api/workflow.controller.ts`
- Restored all broken endpoints:
  - `GET /runs/:id/status` — returns full run state including `yoloState`, `deviations`, `completedSteps`
  - `GET /runs/:id/events` — paginated audit event log
  - `POST /runs/:id/events` — accepts `EXECUTE_STEP`, `YOLO_UPDATE`, `WEIGHT_UPDATE`
- Added new `GET /runs/:id/report` endpoint — returns structured report data for the compliance report page

### `prisma/schema.prisma`
- Synced schema with existing `InventoryItem` table (was missing after merge)
- Added `yoloClass String?` field to `InventoryItem` — stores the COCO object class (e.g. `bottle`) associated with a registered NFC container
- Ran migration: `20260521230029_add_yolo_class_to_inventory`

### `src/api/inventory.controller.ts` — Full Rewrite
- `POST /api/inventory/register` now accepts `yoloClass` field
- `POST /api/hardware/scan` completely redesigned:
  - Previously threw HTTP 404 for unknown NFC UIDs → crashed `nfc-bridge`
  - Now returns graceful response: `{ status: 'UNREGISTERED', uid, message }` so bridge never crashes
  - Returns `{ status: 'EXPIRED' }` with warning message for expired batches
  - Response now includes `yoloClass` so the frontend knows what container YOLO should detect for that material
- `GET /api/hardware/last-scan` unchanged — still stores last UID in-memory

---

## 2. Dashboard Restoration (`sop-interface`)

### `components/WorkflowStatusCard.tsx`
- Restored step progress display (current step index, total steps, progress bar)
- Shows step type badge (`VERIFY` / `MEASURE`), material name, mode, and acceptable range for measurement steps

### `components/EventLogPanel.tsx`
- Restored full event log with timestamped entries
- Fixed type conflict on `validationResult` field (widened from enum to `string`)

### `components/DeviationAlert.tsx`
- Restored real-time deviation banner that appears when `deviations.length > 0`

### `app/runs/[id]/page.tsx`
- Fully restored 6-panel execution dashboard with real-time polling (every 2s)
- Session timer that shows elapsed time since run started
- Header with run ID, SOP template name, status badge, View Report link
- **New**: passes `yoloClass` from the current node config down to both `MaterialVerificationPanel` and `CVStatusPanel`
- `currentYoloClass = currentNode?.config?.yolo_class_name ?? null` — wired through to both panels

### `app/runs/[id]/report/page.tsx` — New File
- Printable compliance report page
- Step-by-step audit table: step title, type, expected vs actual, result, timestamp
- Operator CV summary: people count, PPE status, activity, and whether second verifier was present
- Deviation log section
- Print / Save as PDF button

---

## 3. Material Verification — NFC-First Architecture

### `components/MaterialVerificationPanel.tsx` — Complete Rewrite

**Old design**: operator typed material name manually or selected it; clicked SCAN button to submit.

**New design**: NFC is always the verification method. No typing, no clicking.

#### How it works:
1. Frontend polls `GET /api/hardware/last-scan` every **800ms**
2. When a new scan is detected (timestamp is newer than last seen):
   - Calls `POST /api/hardware/scan` to look up the UID in inventory
   - Compares returned `item.name` with `expectedEntity` from the SOP node
   - If match → automatically fires `EXECUTE_STEP` to the engine → step advances
   - If mismatch → shows `WRONG MATERIAL` state with `SCAN AGAIN` button
   - If expired → fires deviation-tagged event, shows `EXPIRED BATCH` warning
   - If unregistered → shows `NOT REGISTERED` state, guides to `/admin/inventory`
3. Also shows YOLO corroboration: `bottle ○ not detected` / `bottle ✓ detected in frame`

#### States handled:
| State | Meaning |
|---|---|
| `AWAITING` | Polling, no scan yet — pulsing green dot |
| `SCANNING` | Reading tag from DB |
| `VERIFIED` | NFC matched expected material — step auto-advances |
| `MISMATCH` | Wrong material scanned |
| `EXPIRED` | Material past expiry date — deviation logged |
| `UNREGISTERED` | Tag UID not in DB yet |

---

## 4. CV Integration (`sop-cv-service`)

### `yolo_pipeline.py` — Major Fixes

#### Bug Fix: Pose model cannot detect objects
- **Root cause**: `yolov8n-pose.pt` is a pose-only model — it only outputs the `person` class (class 0). It **cannot** detect bottles, cups, bowls, or any other COCO objects.
- **Fix**: Loaded a second model in parallel:
  - `self.pose_model = YOLO('yolov8n-pose.pt')` — person detection + keypoints (PPE, wrist tracking)
  - `self.detect_model = YOLO('yolov8n.pt')` — COCO object detection (bottle, cup, bowl, etc.)
- `process_frame()` now runs both models on every frame and merges results

#### Bug Fix: PPE false PASS
- **Root cause 1**: Lab coat white ratio threshold was `0.35` — a plain white t-shirt was passing
- **Fix**: Raised to `0.55` — only dense white covering (actual lab coat) passes
- **Root cause 2**: Mask check returned `True` (mask present) when face region had very low skin ratio due to hair/background dominating the ROI — no face visible = skin < threshold = pass
- **Fix**: Added guard — if `skin_ratio < 0.05` (face not visible at all), return `False` (assume no mask)

#### Object detection threshold
- Lowered object confidence threshold from `0.30` → `0.15`
- Reason: containers held at arm's length at medium distance often score 0.18–0.25 confidence, below the old threshold

#### `config.json` updated:
```json
"ppe_white_ratio_threshold": 0.55,
"ppe_skin_ratio_threshold": 0.28
```

### `ocr_pipeline.py`
- Added graceful fallback for missing `pytesseract` — uses contour detection instead of crashing
- Service stays alive even without Tesseract OCR installed system-wide

### `main.py`
- Multi-threaded: YOLO worker, OCR worker, push worker all run independently
- Push worker sends `YOLO_UPDATE` and `WEIGHT_UPDATE` to the engine every 300ms
- Accepts `--run-id` CLI argument to target a specific active run

---

## 5. CVStatusPanel — Container Detection Row

### `components/CVStatusPanel.tsx`
- Added `expectedContainer` prop
- New "Expected Container" row below Activity:
  - Green `✓ bottle — DETECTED IN FRAME` when YOLO sees the expected object
  - Grey `○ bottle — NOT DETECTED` when object is not in frame
- Helps operator know whether the camera confirms the container is visible

---

## 6. SOP Canvas — New Buttons (`components/SopBuilder.tsx`)

### Deploy Compliance — Fixed
- Was completely empty (`deployToYolo()` did nothing)
- Now runs full flow:
  1. Validates the canvas DAG
  2. Compiles and saves template to backend DB (`POST /api/sop/templates`)
  3. Creates a new run (`POST /runs`)
  4. Redirects to `/runs/[run_id]` — the live execution dashboard
- Button shows "Starting Run..." with disabled state during operation
- Shows error message if backend is unreachable

### Inventory Button — New
- Added amber `[nfc] Inventory` button to the top bar
- Opens `/admin/inventory` in a new tab so the canvas is preserved

---

## 7. Inventory Registration Page (`app/admin/inventory/page.tsx`)

### New: YOLO Container Class field
- Dropdown added: `Bottle / Cup-Beaker / Bowl-Mortar / Flask-Vase / Volumetric Flask`
- Stored as `yoloClass` in the DB along with the NFC UID
- Used by CVStatusPanel to show expected container detection during verification steps

---

## 8. Architecture — Dual Confirmation for Verification

**New verification contract** (every VERIFICATION step in any SOP):

| Layer | Technology | What it confirms |
|---|---|---|
| **Identity** | NFC scan → DB lookup | Exact material name, batch number, expiry date |
| **Visual** | YOLO detect model | Container shape/type is physically present in frame |

Both pieces of data are logged into `RunEvent` in the compliance audit trail:
```json
{
  "type": "EXECUTE_STEP",
  "payload": {
    "verified_entity": "Salt",
    "success": true,
    "nfc_uid": "7F29BBDD",
    "batch_no": "BCH-2024-441",
    "yolo_container_detected": true,
    "source": "NFC"
  }
}
```

---

## 9. Summary of Verified Working State

| Service | Port | Status |
|---|---|---|
| `sop-engine` (NestJS) | 3000 | ✅ Running, all endpoints functional |
| `sop-interface` (Next.js) | 3001 | ✅ Running, 0 TypeScript errors |
| `sop-cv-service` (Flask) | 8001 | ✅ Running, dual-model YOLO + OCR fallback |
| `nfc-bridge` (Node) | — | ✅ Ready, graceful UNREGISTERED handling |

### Confirmed working in live test:
- PPE FAIL correctly shown when no lab coat/mask worn
- Bottle detected at 84% confidence with `yolov8n.pt`
- Person count, station occupied, activity all updating in real time
- NFC panel polling every 800ms with auto-verification logic
- Deploy Compliance button → creates run → redirects to dashboard

---

## 10. Known Remaining Items

| Item | Status |
|---|---|
| Tesseract OCR for weighing scale | Not installed — contour fallback active, numeric accuracy reduced |
| NFC hardware verification end-to-end | Requires Arduino + physical NFC tags |
| `POST_HOC_VISION` mode (YOLO auto-verify) | Code complete, not the primary mode anymore — NFC is mandatory |
| Second verifier workflow enforcement | Tracked in `yoloState.secondVerifier` but not yet a hard-block |
