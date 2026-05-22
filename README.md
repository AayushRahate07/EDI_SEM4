# EDI_SEM4 — SOP Workflow Studio

> **Team Collab** | Semester 4 EDI Project  
> A full-stack platform for building, validating, and executing **Standard Operating Procedures (SOPs)** as visual node-based DAG workflows with NFC-based physical inventory verification.

---

## Table of Contents

- [System Architecture](#system-architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Repository Structure](#repository-structure)
- [First-Time Setup](#first-time-setup)
- [Daily Development Workflow](#daily-development-workflow)
- [API Reference](#api-reference)
- [Pages & Routes](#pages--routes)
- [Hardware Setup (Arduino + NFC)](#hardware-setup-arduino--nfc)
- [Database](#database)
- [Troubleshooting](#troubleshooting)

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Team's Browser                           │
│                   http://localhost:3001                         │
│                                                                 │
│   ┌─────────────────────┐   ┌──────────────────────────────┐   │
│   │  / (SOP Canvas)     │   │  /admin/inventory            │   │
│   │  Visual DAG Builder │   │  NFC Tag Registration Form   │   │
│   └─────────┬───────────┘   └──────────────┬───────────────┘   │
└─────────────┼──────────────────────────────┼───────────────────┘
              │  HTTP REST                   │  HTTP REST
              ▼                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      sop-engine (NestJS)                        │
│                     http://localhost:3000                        │
│                                                                 │
│   POST /api/sop/templates   ← Save canvas workflow to DB        │
│   GET  /api/inventory       ← List registered NFC items         │
│   POST /api/inventory/register  ← Register new NFC item         │
│   POST /api/hardware/scan   ← Look up item by NFC UID           │
│   GET  /api/hardware/last-scan  ← Polling for auto-fill         │
│   POST /runs                ← Start a workflow execution run     │
│   POST /runs/:id/events     ← Submit step result to engine      │
│   GET  /runs/:id/status     ← Get current run state             │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              SQLite Database (Prisma ORM)               │   │
│   │  SopTemplate | SopNode | SopTransition | WorkflowRun   │   │
│   │  RunEvent | InventoryItem                               │   │
│   └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────┬───────────────────────┘
                                          │ POST /api/hardware/scan
                                          │ (one POST per tag tap)
                              ┌───────────┴──────────────┐
                              │   nfc-bridge (Node.js)   │
                              │   Runs on laptop with    │
                              │   Arduino plugged in     │
                              │                          │
                              │   Arduino (MFRC522)      │
                              │   ← Serial (USB) →       │
                              │   Reads NFC tag UID      │
                              └──────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | Next.js (App Router) | 16.x |
| Backend | NestJS | 11.x |
| ORM | Prisma | 7.x |
| Database | SQLite (via better-sqlite3) | — |
| State Machine | XState | 5.x |
| Validation | Zod | 4.x |
| Hardware Bridge | Node.js + serialport | 18.x |

---

## Prerequisites

Install these on every machine before cloning:

| Tool | Minimum Version | Download |
|------|----------------|----------|
| **Node.js** | v18.0+ | https://nodejs.org (LTS recommended) |
| **npm** | v9.0+ | Included with Node.js |
| **Git** | any | https://git-scm.com |

> **For hardware NFC scanning only:** Install [Arduino IDE](https://www.arduino.cc/en/software) so the USB-Serial drivers are present and the COM port appears in Device Manager.

Verify your versions:
```bash
node --version   # should print v18.x.x or higher
npm --version    # should print 9.x.x or higher
```

---

## Repository Structure

```
EDI_SEM4/
│
├── README.md                    ← You are here
├── CHANGES.md                   ← Full log of every feature added & bug fixed
│
├── sop-engine/                  ← NestJS Backend (Port 3000)
│   ├── prisma/
│   │   ├── schema.prisma        ← All database model definitions
│   │   └── migrations/          ← SQL migration history (DO commit this)
│   ├── src/
│   │   ├── main.ts              ← NestJS bootstrap
│   │   ├── app.module.ts        ← Root module, controller registration
│   │   ├── sop.controller.ts    ← POST /api/sop/templates
│   │   ├── api/
│   │   │   ├── inventory.controller.ts  ← NFC inventory endpoints
│   │   │   └── workflow.controller.ts   ← Run execution endpoints
│   │   ├── engine/
│   │   │   └── workflow.compiler.ts     ← DAG → XState machine
│   │   ├── persistence/
│   │   │   ├── prisma.service.ts        ← PrismaClient wrapper
│   │   │   ├── run.repository.ts        ← DB access for WorkflowRuns
│   │   │   └── persistence.module.ts
│   │   └── schemas/
│   │       └── sop.schema.ts    ← Zod schemas for all API payloads
│   ├── prisma.config.ts         ← Prisma v7 datasource config (DB path)
│   └── package.json
│
├── sop-interface/               ← Next.js Frontend (Port 3001)
│   ├── app/
│   │   ├── page.tsx             ← Root page (SOP canvas)
│   │   └── admin/
│   │       └── inventory/
│   │           └── page.tsx     ← NFC item registration form
│   ├── components/
│   │   └── SopBuilder.tsx       ← Main visual DAG builder (2300+ lines)
│   └── package.json
│
└── nfc-bridge/                  ← Arduino Hardware Bridge (Node.js)
    ├── index.js                 ← Serial reader → HTTP forwarder
    └── package.json
```

---

## First-Time Setup

> Do this **once** after cloning. You need three separate terminal windows.

### Step 1 — Backend (`sop-engine`)

```bash
cd sop-engine

# Install all Node.js dependencies
npm install

# Create the local SQLite database and apply all migrations
npx prisma migrate deploy

# Generate the Prisma TypeScript client
npx prisma generate

# Start the server (hot-reload enabled)
npm run start:dev
```

✅ You should see: `[NestApplication] Nest application successfully started`  
The backend is now running on **http://localhost:3000**

---

### Step 2 — Frontend (`sop-interface`)

Open a **new terminal**:

```bash
cd sop-interface
npm install
npm run dev
```

✅ You should see: `✓ Ready in ~400ms`  
The frontend is now running on **http://localhost:3001**

> If port 3000 is already taken by the backend, Next.js automatically picks 3001. This is expected.

---

### Step 3 — NFC Bridge (`nfc-bridge`) — Hardware Only

> Only needed if you have an Arduino with MFRC522 NFC reader physically connected.

**Find your Arduino's serial port first:**
- **Windows:** Open Device Manager → Ports (COM & LPT) → look for "USB Serial Device (COMx)"
- **macOS:** Run `ls /dev/tty.*` in terminal
- **Linux:** Run `ls /dev/ttyUSB* /dev/ttyACM*`

Open a **third terminal**:

```bash
cd nfc-bridge
npm install

# Windows (replace COM6 with your actual port):
set COM_PORT=COM6 && npm start

# macOS:
COM_PORT=/dev/tty.usbmodem14101 npm start

# Linux:
COM_PORT=/dev/ttyUSB0 npm start
```

✅ You should see: `Starting NFC Hardware Bridge on COM6...`

---

## Daily Development Workflow

Once set up, just run these three commands (each in its own terminal):

```bash
# Terminal 1 — Backend
cd sop-engine && npm run start:dev

# Terminal 2 — Frontend  
cd sop-interface && npm run dev

# Terminal 3 — NFC Bridge (only if using hardware)
cd nfc-bridge && set COM_PORT=COM6 && npm start
```

Then open **http://localhost:3001** in your browser.

---

## API Reference

### SOP Template Management

| Method | Endpoint | Description | Body |
|--------|----------|-------------|------|
| `POST` | `/api/sop/templates` | Save or overwrite a workflow template from the canvas | `SopDag` JSON |

### Workflow Execution Engine

| Method | Endpoint | Description | Body |
|--------|----------|-------------|------|
| `POST` | `/runs` | Start a new workflow execution run | `{ sopId }` |
| `POST` | `/runs/:id/events` | Submit a step result (PASS/FAIL) to the state machine | `{ type, payload }` |
| `GET`  | `/runs/:id/status` | Get the current state + snapshot of a run | — |

### Inventory & NFC Hardware

| Method | Endpoint | Description | Body |
|--------|----------|-------------|------|
| `GET`  | `/api/inventory` | Fetch all registered inventory items (newest first) | — |
| `POST` | `/api/inventory/register` | Register a new NFC-tagged physical item | `{ nfcUid, name, batchNo?, expiryDate? }` |
| `POST` | `/api/hardware/scan` | Look up an item by NFC UID; returns status + expiry check | `{ uid }` |
| `GET`  | `/api/hardware/last-scan` | Returns the most recently scanned UID + timestamp (used for frontend polling) | — |

---

## Pages & Routes

| URL | Description |
|-----|-------------|
| `http://localhost:3001/` | Main SOP canvas — drag-and-drop workflow builder |
| `http://localhost:3001/admin/inventory` | Inventory registration — link NFC tags to materials |

---

## Hardware Setup (Arduino + NFC)

The system uses an **Arduino** with an **MFRC522 NFC/RFID reader** module.

**How the data flows:**
1. Tag is held near the reader
2. Arduino reads the UID and prints it over Serial (`9600` baud)
3. `nfc-bridge/index.js` reads the serial line, extracts the hex UID
4. Bridge POSTs `{ uid }` to `POST /api/hardware/scan`
5. Backend stores the UID in memory (`lastScan`) and looks up the item in the DB
6. The `/admin/inventory` page polls `GET /api/hardware/last-scan` every 1.5 seconds
7. When a new scan is detected, the NFC UID field auto-fills

**Arduino Serial output format expected:**
```
UID:6FDAABDD
```
The bridge regex `/([A-Fa-f0-9]{8,14})/` extracts any 8–14 character hex string from the line.

---

## Database

The project uses **SQLite** managed by **Prisma ORM**.

| Model | Table | Purpose |
|-------|-------|---------|
| `SopTemplate` | `sop_templates` | Stores canvas workflow metadata |
| `SopNode` | `sop_nodes` | Individual steps within a workflow |
| `SopTransition` | `sop_transitions` | Edges/connections between nodes |
| `WorkflowRun` | `workflow_runs` | Active/completed execution instances |
| `RunEvent` | `run_events` | Step-by-step audit trail |
| `InventoryItem` | `inventory_items` | NFC-tagged physical materials |

**The database file (`prisma/dev.db`) is NOT committed to git.** Each developer gets their own empty local database created by running `npx prisma migrate deploy`.

**To add a new field or table:**
```bash
# 1. Edit prisma/schema.prisma
# 2. Create and apply the migration
npx prisma migrate dev --name describe_your_change
# 3. Regenerate the client
npx prisma generate
```

---

## Troubleshooting

### `'nest' is not recognized`
```bash
# Use npx instead:
cd sop-engine && npx nest start --watch
```

### `Prisma Client not generated`
```bash
cd sop-engine && npx prisma generate
```

### `Port 3000 is already in use` (frontend warning)
This is **expected and normal**. The backend uses 3000, so Next.js uses 3001. No action needed.

### `Error opening port` (NFC bridge)
Your `COM_PORT` is wrong. Check Device Manager (Windows) or run `ls /dev/tty.*` (macOS).

### Inventory dropdown in canvas is empty
The backend must be running **before** you open the browser. The dropdown fetches on page load. Restart the backend, then refresh the browser.

### `Item not found in inventory` in bridge logs
This is **expected** when scanning a tag that hasn't been registered yet. Go to `http://localhost:3001/admin/inventory`, register the tag, then scan again.

### After pulling latest code — DB schema changed
```bash
cd sop-engine
npx prisma migrate deploy
npx prisma generate
```
