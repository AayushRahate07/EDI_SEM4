-- CreateTable
CREATE TABLE "sop_templates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "template_id" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "start_node_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "sop_nodes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "id_from_ui" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "x" REAL NOT NULL,
    "y" REAL NOT NULL,
    "config" TEXT NOT NULL,
    CONSTRAINT "sop_nodes_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "sop_templates" ("template_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sop_transitions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "from_node_id" TEXT NOT NULL,
    "to_node_id" TEXT NOT NULL,
    "condition" TEXT NOT NULL DEFAULT 'DEFAULT',
    CONSTRAINT "sop_transitions_from_node_id_fkey" FOREIGN KEY ("from_node_id") REFERENCES "sop_nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sop_transitions_to_node_id_fkey" FOREIGN KEY ("to_node_id") REFERENCES "sop_nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "sop_templates_template_id_key" ON "sop_templates"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "sop_nodes_template_id_id_from_ui_key" ON "sop_nodes"("template_id", "id_from_ui");

-- CreateIndex
CREATE UNIQUE INDEX "sop_transitions_from_node_id_to_node_id_condition_key" ON "sop_transitions"("from_node_id", "to_node_id", "condition");
