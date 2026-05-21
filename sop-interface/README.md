# sop-interface — Frontend

Next.js 16 frontend for the SOP Workflow Studio. Provides the visual DAG canvas for building SOPs and the admin page for NFC inventory registration.

**Runs on:** `http://localhost:3001`  
**Depends on:** `sop-engine` running on `http://localhost:3000`

---

## Setup

```bash
npm install
npm run dev       # development server with hot-reload
npm run build     # production build (for verification)
```

---

## Pages

### `/` — SOP Canvas (`app/page.tsx`)

The main interface. A full-screen visual node graph editor where users:

- **Add nodes** using the VERIFY / MEASURE buttons in the right sidebar
- **Connect nodes** by dragging from the bottom port of one node to the top port of another
- **Configure nodes** via the sidebar:
  - `VERIFICATION` nodes: select an ingredient from the live inventory dropdown, choose verification mode (Barcode / Manual Entry / Post-hoc Vision)
  - `MEASUREMENT` nodes: set target value, unit (mg/g/ml/°C), and tolerance (±)
- **Set branching conditions** on each edge (DEFAULT / RESOLVE / RETRY / REJECT)
- **Generate SOPs with AI** using the text input at the bottom of the sidebar
- **Save the workflow** using "Validate & Save Configuration" which compiles the canvas to a JSON DAG and POSTs it to `POST /api/sop/templates`

### `/admin/inventory` — Inventory Registration (`app/admin/inventory/page.tsx`)

A form for lab managers to register physical materials against NFC tags:

- **NFC UID field** auto-fills within 1.5 seconds when a tag is held near the Arduino reader (polls `GET /api/hardware/last-scan`)
- **Material Name** (required)
- **Batch Number** (optional)
- **Expiry Date** (optional)
- On submit: POSTs to `POST /api/inventory/register`
- Success banner auto-clears after 4 seconds

---

## Key Component: `SopBuilder.tsx`

The entire canvas lives in `components/SopBuilder.tsx` (~2,374 lines). Key sections:

| Line range | What it does |
|-----------|-------------|
| ~1–30 | TypeScript interfaces (`NodeData`, `Edge`) |
| ~30–150 | Main `SopBuilder` component state and canvas logic |
| ~150–443 | SVG canvas rendering, node drawing, edge drawing, port connection logic |
| ~444–533 | `Sidebar` component — props, state, inventory fetch `useEffect` |
| ~534–970 | Sidebar JSX — all node configuration panels |
| ~970–1200 | `compile()` function — converts canvas state to `SopDag` JSON |
| ~1200+ | Save modal, AI injection, keyboard handlers |

### Inventory Dropdown (VERIFICATION nodes)

When the `Sidebar` mounts, it fetches `GET http://localhost:3000/api/inventory` once and populates the "Expected Label" `<select>` dropdown. The dropdown shows `Item Name (NFC_UID)` for each registered item.

---

## API Calls Made by Frontend

| From | To | Purpose |
|------|----|---------|
| `SopBuilder.tsx` | `POST /api/sop/templates` | Save compiled workflow |
| `SopBuilder.tsx` | `GET /api/inventory` | Populate VERIFICATION dropdown |
| `app/admin/inventory/page.tsx` | `POST /api/inventory/register` | Register new item |
| `app/admin/inventory/page.tsx` | `GET /api/hardware/last-scan` | Poll for NFC auto-fill (every 1.5s) |

---

## Compile Output Format (`SopDag`)

When the user clicks "Validate & Save", `compile()` builds this JSON structure:

```json
{
  "template_id": "SOP-12345",
  "version": "1.0.0",
  "start_node_id": "step_manual_1",
  "nodes": [
    {
      "id": "step_manual_1",
      "type": "VERIFICATION",
      "title": "Check Ingredient A",
      "config": {
        "entity_name": "Base Alcohol 90%",
        "mode": "MANUAL_ENTRY"
      },
      "next_nodes": ["step_manual_2"]
    },
    {
      "id": "step_manual_2",
      "type": "MEASUREMENT",
      "title": "Weigh Ingredient A",
      "config": {
        "target_value": 500,
        "unit": "mg",
        "tolerance_positive": 5,
        "tolerance_negative": 5
      },
      "next_nodes": ["WORKFLOW_COMPLETE"]
    }
  ]
}
```

This format is validated by Zod on the backend before being written to the database.
