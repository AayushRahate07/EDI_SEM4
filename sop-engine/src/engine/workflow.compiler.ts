import { createMachine, assign } from 'xstate';
import { SopDag, SopNode } from '../schemas/sop.schema';

export interface WorkflowContext {
  runId: string;
  currentNodeId: string;
  completedNodes: string[];
  deviations: Array<{ stepId: string; issue: string; timestamp: string }>;
  eventHistory: Array<{ type: string; payload: any; timestamp: string }>;
}

export function compileDagToMachine(dag: SopDag, runId: string) {
  const initialContext: WorkflowContext = {
    runId,
    currentNodeId: dag.start_node_id,
    completedNodes: [],
    deviations: [],
    eventHistory: [],
  };

  const statesConfig: Record<string, any> = {};

  // Dynamically map every DAG node into an immutable XState node
  for (const node of dag.nodes) {
    statesConfig[node.id] = {
      entry: assign({ currentNodeId: node.id }),
      on: {
        EXECUTE_STEP: [
          {
            // Target Gate 1: Enforce input payload compliance via declarative validation rules
            guard: ({ event }) => validateNodeEvent(node, event.payload),
            actions: assign({
              completedNodes: ({ context }) => [...context.completedNodes, node.id],
              eventHistory: ({ context, event }) => [
                ...context.eventHistory,
                { type: 'STEP_SUCCESS', payload: event.payload, timestamp: new Date().toISOString() }
              ]
            }),
            target: getNextStateTarget(node)
          },
          {
            // Target Gate 2: Trap deviations instantly without updating the pointer position
            actions: assign({
              deviations: ({ context }) => [
                ...context.deviations,
                { stepId: node.id, issue: `Input criteria out of bounds for step type: ${node.type}`, timestamp: new Date().toISOString() }
              ],
              eventHistory: ({ context, event }) => [
                ...context.eventHistory,
                { type: 'DEVIATION_TRIGGERED', payload: event.payload, timestamp: new Date().toISOString() }
              ]
            })
          }
        ]
      }
    };
  }

  // Handle explicit final node termination state
  statesConfig['WORKFLOW_COMPLETE'] = { type: 'final' };

  return createMachine({
    id: `workflow_${dag.template_id}`,
    initial: dag.start_node_id,
    context: initialContext,
    states: statesConfig,
  });
}

function validateNodeEvent(node: SopNode, payload: any): boolean {
  if (!payload) return false;
  
  if (node.type === 'MEASUREMENT') {
    const val = payload.value;
    const low = node.config.target_value - node.config.tolerance_negative;
    const high = node.config.target_value + node.config.tolerance_positive;
    return val >= low && val <= high;
  }
  
  if (node.type === 'VERIFICATION') {
    const targetEntity = node.config.yolo_class_name ?? node.config.entity_name;
    const isEntityMatch = payload.verified_entity === targetEntity;
    
    const threshold = node.config.confidence_threshold ?? 0.0;
    const isConfidenceValid = payload.confidence !== undefined ? payload.confidence >= threshold : true;
    
    return isEntityMatch && payload.success === true && isConfidenceValid;
  }
  
  return true;
}

function getNextStateTarget(node: SopNode): string {
  if (node.type === 'DECISION_BRANCH') {
    return Object.values(node.next_nodes)[0] || 'WORKFLOW_COMPLETE';
  }
  return node.next_nodes[0] || 'WORKFLOW_COMPLETE';
}