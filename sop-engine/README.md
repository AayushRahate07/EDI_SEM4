# sop-engine

NestJS backend for the SOP Workflow Studio. Handles template persistence, workflow execution via XState, and NFC inventory management.

## Setup

```bash
npm install
npx prisma migrate deploy   # run this once to create the local SQLite database
npx prisma generate         # regenerate client after any schema changes
```

## Running

```bash
npm run start:dev   # development (hot-reload)
npm run start       # production
npm run build       # compile TypeScript
```

## Database

The SQLite database (`prisma/dev.db`) is **not committed to git** — it is created locally by running migrations. Migration files in `prisma/migrations/` are committed and track all schema changes.

To add a new migration after editing `prisma/schema.prisma`:
```bash
npx prisma migrate dev --name describe_your_change
npx prisma generate
```

## Key Files

| File | Purpose |
|------|---------|
| `src/sop.controller.ts` | `POST /api/sop/templates` — saves canvas workflow to DB |
| `src/api/workflow.controller.ts` | `POST /runs`, `/runs/:id/events`, `GET /runs/:id/status` |
| `src/api/inventory.controller.ts` | NFC inventory CRUD + hardware scan endpoint |
| `src/engine/workflow.compiler.ts` | Converts a DAG to an XState machine |
| `src/schemas/sop.schema.ts` | Zod validation for all incoming payloads |
| `prisma/schema.prisma` | Database models (SopTemplate, SopNode, InventoryItem, etc.) |
