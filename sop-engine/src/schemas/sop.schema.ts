import { z } from 'zod';

export const MeasurementNodeSchema = z.object({
  id: z.string(),
  type: z.literal('MEASUREMENT'),
  title: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  config: z.object({
    target_value: z.number().positive(),
    unit: z.enum(['mg', 'g', 'ml', 'C']),
    tolerance_positive: z.number().nonnegative(),
    tolerance_negative: z.number().nonnegative(),
  }),
  next_nodes: z.array(z.string()),
});

export const VerificationNodeSchema = z.object({
  id: z.string(),
  type: z.literal('VERIFICATION'),
  title: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  config: z.object({
    entity_name: z.string(),
    mode: z.enum(['BARCODE', 'MANUAL_ENTRY', 'POST_HOC_VISION']),
    confidence_threshold: z.number().min(0).max(1).optional(),
    yolo_class_name: z.string().optional(),
  }),
  next_nodes: z.array(z.string()),
});

export const DecisionNodeSchema = z.object({
  id: z.string(),
  type: z.literal('DECISION_BRANCH'),
  title: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  config: z.object({
    condition_field: z.string(),
  }),
  next_nodes: z.record(z.string(), z.string()),
});

export const SopNodeSchema = z.discriminatedUnion('type', [
  MeasurementNodeSchema,
  VerificationNodeSchema,
  DecisionNodeSchema,
]);

export const SopDagSchema = z.object({
  template_id: z.string(),
  version: z.string(),
  start_node_id: z.string(),
  nodes: z.array(SopNodeSchema),
}).refine((dag) => {
  const nodeIds = new Set(dag.nodes.map(n => n.id));
  if (!nodeIds.has(dag.start_node_id)) return false;
  const TERMINAL_ID = 'WORKFLOW_COMPLETE';
  for (const node of dag.nodes) {
    if (node.type === 'DECISION_BRANCH') {
      if (Object.values(node.next_nodes).some(t => t !== TERMINAL_ID && !nodeIds.has(t))) return false;
    } else {
      if (node.next_nodes.some(t => t !== TERMINAL_ID && !nodeIds.has(t))) return false;
    }
  }
  return true;
}, { message: "DAG graph validation failed" });

export type SopDag = z.infer<typeof SopDagSchema>;
export type SopNode = z.infer<typeof SopNodeSchema>;