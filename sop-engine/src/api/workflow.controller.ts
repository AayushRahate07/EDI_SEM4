// src/api/workflow.controller.ts
import { Controller, Post, Get, Body, Param, NotFoundException } from '@nestjs/common';
import { RunRepository } from '../persistence/run.repository';
import { PrismaService } from '../persistence/prisma.service';
import { createActor } from 'xstate';
import { compileDagToMachine } from '../engine/workflow.compiler';
import { SopDagSchema, SopDag } from '../schemas/sop.schema';

@Controller('runs')
export class WorkflowController {
  constructor(
    private runRepo: RunRepository,
    private prisma: PrismaService
  ) {}

  // Helper to extract node-edge layout from database and format for XState/Zod
  private async fetchAndBuildTemplatePayload(templateId: string): Promise<SopDag> {
    const dbTemplate = await this.prisma.client.sopTemplate.findUnique({
      where: { templateId },
      include: { 
        nodes: {
          include: {
            outgoingTransitions: {
              include: { toNode: true }
            }
          }
        }
      },
    });

    if (!dbTemplate) {
      throw new NotFoundException(`SOP Template Blueprint "${templateId}" not found.`);
    }

    const templatePayload = {
      template_id: dbTemplate.templateId,
      version: dbTemplate.version,
      start_node_id: dbTemplate.startNodeId ?? '',
      nodes: dbTemplate.nodes.map(node => {
        const connectedTargets = node.outgoingTransitions.map(t => t.toNode.idFromUi);

        return {
          id: node.idFromUi,
          type: node.type as 'MEASUREMENT' | 'VERIFICATION' | 'DECISION_BRANCH',
          title: node.title,
          config: JSON.parse(node.config),
          next_nodes: connectedTargets
        };
      })
    };

    return SopDagSchema.parse(templatePayload) as SopDag;
  }

  @Post()
  async startRun(@Body() body: { sopId: string; runId: string }) {
    const validatedDag = await this.fetchAndBuildTemplatePayload(body.sopId);
    
    const machine = compileDagToMachine(validatedDag, body.runId);
    const actor = createActor(machine).start();

    await this.runRepo.initializeRun(
      body.runId,
      body.sopId,
      validatedDag.start_node_id,
      JSON.stringify(actor.getSnapshot())
    );

    return {
      run_id: body.runId,
      status: "ACTIVE",
      current_step: validatedDag.start_node_id
    };
  }

  @Post(':id/events')
  async processEvent(@Param('id') id: string, @Body() eventPayload: { type: string; payload: any }) {
    const runMetadata = await this.prisma.client.workflowRun.findUnique({
      where: { id },
    });
    if (!runMetadata) throw new NotFoundException(`Active workflow run instance "${id}" not found.`);

    const validatedDag = await this.fetchAndBuildTemplatePayload(runMetadata.sopId);
    const actor = await this.runRepo.rehydrateActor(id, validatedDag);
    const oldSnapshot = actor.getSnapshot();

    actor.send({ type: 'EXECUTE_STEP', payload: eventPayload.payload });
    const newSnapshot = actor.getSnapshot();

    const deviationTriggered = newSnapshot.context.deviations.length > oldSnapshot.context.deviations.length;
    const validationResult = deviationTriggered ? 'DEVIATION' : 'PASS';

    await this.runRepo.saveEngineState(id, newSnapshot, validationResult, eventPayload);

    return {
      status: newSnapshot.status === 'done' ? 'WORKFLOW_COMPLETE' : 'ACTIVE',
      current_step: newSnapshot.context.currentNodeId,
      deviation: deviationTriggered ? newSnapshot.context.deviations[newSnapshot.context.deviations.length - 1] : null
    };
  }

  @Get(':id/status')
  async getStatus(@Param('id') id: string) {
    const runMetadata = await this.prisma.client.workflowRun.findUnique({
      where: { id },
    });
    if (!runMetadata) throw new NotFoundException(`Workflow run "${id}" not found.`);

    const validatedDag = await this.fetchAndBuildTemplatePayload(runMetadata.sopId);
    const actor = await this.runRepo.rehydrateActor(id, validatedDag);
    const snapshot = actor.getSnapshot();

    return {
      run_id: id,
      current_step: snapshot.context.currentNodeId,
      completed_steps: snapshot.context.completedNodes,
      deviations: snapshot.context.deviations,
      history_log_count: snapshot.context.eventHistory.length
    };
  }
}