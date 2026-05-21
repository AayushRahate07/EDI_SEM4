-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nfc_uid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "batch_no" TEXT,
    "expiry_date" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_nfc_uid_key" ON "inventory_items"("nfc_uid");
