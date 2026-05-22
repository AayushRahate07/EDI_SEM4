/* eslint-disable */
// src/api/workflow.controller.ts
import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { RunRepository } from '../persistence/run.repository';
import { PrismaService } from '../persistence/prisma.service';
import { createActor } from 'xstate';
import { compileDagToMachine } from '../engine/workflow.compiler';
import { SopDagSchema, SopDag } from '../schemas/sop.schema';
import { randomUUID } from 'crypto';

@Controller('runs')
export class WorkflowController {
  constructor(
    private runRepo: RunRepository,
    private prisma: PrismaService,
  ) {}

  // ── Helper: fetch SOP template from DB and validate ──────────────────────────
  private async fetchAndBuildTemplatePayload(
    templateId: string,
  ): Promise<SopDag> {
    const dbTemplate = await this.prisma.client.sopTemplate.findUnique({
      where: { templateId },
      include: {
        nodes: {
          include: {
            outgoingTransitions: { include: { toNode: true } },
          },
        },
      },
    });

    if (!dbTemplate) {
      throw new NotFoundException(
        `SOP Template Blueprint "${templateId}" not found.`,
      );
    }
    if (!dbTemplate.startNodeId) {
      throw new NotFoundException(
        `SOP Template "${templateId}" has no start node configured.`,
      );
    }

    const templatePayload = {
      template_id: dbTemplate.templateId,
      version: dbTemplate.version,
      start_node_id: dbTemplate.startNodeId,
      nodes: dbTemplate.nodes.map((node) => ({
        id: node.idFromUi,
        type: node.type as 'MEASUREMENT' | 'VERIFICATION' | 'DECISION_BRANCH',
        title: node.title,
        config: JSON.parse(node.config),
        next_nodes: node.outgoingTransitions.map((t) => t.toNode.idFromUi),
        x: node.x,
        y: node.y,
      })),
    };

    const parsed = SopDagSchema.safeParse(templatePayload);
    if (!parsed.success) {
      throw new NotFoundException(
        `Stored SOP Template "${templateId}" has corrupted data: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  // ── POST /runs — Start a new workflow run ────────────────────────────────────
  @Post()
  async startRun(@Body() body: { sopId: string; runId?: string }) {
    const runId = body.runId || randomUUID();

    const existing = await this.prisma.client.workflowRun.findUnique({
      where: { id: runId },
    });
    if (existing) {
      throw new ConflictException(`Workflow run "${runId}" already exists.`);
    }

    const validatedDag = await this.fetchAndBuildTemplatePayload(body.sopId);
    const machine = compileDagToMachine(validatedDag, runId);
    const actor = createActor(machine).start();
    const initialSnapshot = actor.getSnapshot();
    actor.stop();

    await this.runRepo.initializeRun(
      runId,
      body.sopId,
      validatedDag.start_node_id,
      JSON.stringify(initialSnapshot),
    );

    return {
      run_id: runId,
      status: 'ACTIVE',
      current_step: validatedDag.start_node_id,
    };
  }

  // ── POST /runs/:id/events — Send an event to the running workflow ─────────────
  @Post(':id/events')
  async processEvent(
    @Param('id') id: string,
    @Body() eventPayload: { type: string; payload: any },
  ) {
    const runMetadata = await this.prisma.client.workflowRun.findUnique({
      where: { id },
    });
    if (!runMetadata)
      throw new NotFoundException(`Workflow run "${id}" not found.`);

    const validatedDag = await this.fetchAndBuildTemplatePayload(
      runMetadata.sopId,
    );
    const actor = await this.runRepo.rehydrateActor(id, validatedDag);
    const oldSnapshot = actor.getSnapshot();

    actor.send({ type: eventPayload.type, payload: eventPayload.payload });
    const newSnapshot = actor.getSnapshot();
    actor.stop();

    // CV sensor updates (YOLO/WEIGHT) are not logged as RunEvents — too frequent
    const isSensorUpdate =
      eventPayload.type === 'YOLO_UPDATE' ||
      eventPayload.type === 'WEIGHT_UPDATE';
    if (!isSensorUpdate) {
      const deviationTriggered =
        newSnapshot.context.deviations.length >
        oldSnapshot.context.deviations.length;
      const validationResult = deviationTriggered ? 'DEVIATION' : 'PASS';
      await this.runRepo.saveEngineState(
        id,
        newSnapshot,
        validationResult,
        eventPayload,
      );
    } else {
      // Sensor updates: persist snapshot only, skip event log
      await this.prisma.client.workflowRun.update({
        where: { id },
        data: { snapshotJson: JSON.stringify(newSnapshot) },
      });
    }

    const deviationTriggered =
      newSnapshot.context.deviations.length >
      oldSnapshot.context.deviations.length;
    return {
      status: newSnapshot.status === 'done' ? 'WORKFLOW_COMPLETE' : 'ACTIVE',
      current_step: newSnapshot.context.currentNodeId,
      deviation: deviationTriggered
        ? newSnapshot.context.deviations[
            newSnapshot.context.deviations.length - 1
          ]
        : null,
    };
  }

  // ── GET /runs/:id/status — Full dashboard snapshot ───────────────────────────
  @Get(':id/status')
  async getStatus(@Param('id') id: string) {
    const runMetadata = await this.prisma.client.workflowRun.findUnique({
      where: { id },
    });
    if (!runMetadata)
      throw new NotFoundException(`Workflow run "${id}" not found.`);

    const validatedDag = await this.fetchAndBuildTemplatePayload(
      runMetadata.sopId,
    );
    const actor = await this.runRepo.rehydrateActor(id, validatedDag);
    const snapshot = actor.getSnapshot();
    actor.stop();

    return {
      run_id: id,
      sop_id: runMetadata.sopId,
      status: runMetadata.status,
      current_step: snapshot.context.currentNodeId,
      completed_steps: snapshot.context.completedNodes,
      deviations: snapshot.context.deviations,
      nodes: validatedDag.nodes, // Full node list for dashboard rendering
      yoloState: snapshot.context.yoloState, // Live CV state
      weightState: snapshot.context.weightState, // Live scale state
    };
  }

  // ── GET /runs/:id/events — Audit event log ───────────────────────────────────
  @Get(':id/events')
  async getEvents(@Param('id') id: string) {
    const run = await this.prisma.client.workflowRun.findUnique({
      where: { id },
    });
    if (!run) throw new NotFoundException(`Workflow run "${id}" not found.`);

    const events = await this.prisma.client.runEvent.findMany({
      where: { runId: id },
      orderBy: { timestamp: 'asc' },
    });

    return events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      payload: JSON.parse(e.payloadJson),
      validationResult: e.validationResult,
      timestamp: e.timestamp.toISOString(),
    }));
  }

  // ── GET /runs/:id/report — Full compliance report ────────────────────────────
  @Get(':id/report')
  async getReport(@Param('id') id: string) {
    const run = await this.prisma.client.workflowRun.findUnique({
      where: { id },
    });
    if (!run) throw new NotFoundException(`Workflow run "${id}" not found.`);

    const validatedDag = await this.fetchAndBuildTemplatePayload(run.sopId);
    const actor = await this.runRepo.rehydrateActor(id, validatedDag);
    const snapshot = actor.getSnapshot();
    actor.stop();

    const events = await this.prisma.client.runEvent.findMany({
      where: { runId: id },
      orderBy: { timestamp: 'asc' },
    });

    const startedAt = run.createdAt;
    const completedAt = run.status === 'COMPLETED' ? run.updatedAt : null;
    const durationSeconds = completedAt
      ? Math.round((completedAt.getTime() - startedAt.getTime()) / 1000)
      : Math.round((Date.now() - startedAt.getTime()) / 1000);

    // Build per-step audit rows
    const stepRows = validatedDag.nodes.map((node) => {
      const successEvent = events.find(
        (e) =>
          e.eventType === 'EXECUTE_STEP' &&
          e.validationResult === 'PASS' &&
          snapshot.context.completedNodes.includes(node.id),
        // Match by order of completion
      );
      const deviations = snapshot.context.deviations.filter(
        (d) => d.stepId === node.id,
      );
      const completed = snapshot.context.completedNodes.includes(node.id);

      let submittedValue: any = null;
      if (successEvent) {
        const p = JSON.parse(successEvent.payloadJson);
        submittedValue = p.value ?? p.verified_entity ?? null;
      }

      return {
        node_id: node.id,
        title: node.title,
        type: node.type,
        status: completed
          ? 'PASS'
          : deviations.length > 0
            ? 'DEVIATION'
            : 'PENDING',
        submitted_value: submittedValue,
        target_value:
          node.type === 'MEASUREMENT' ? node.config.target_value : null,
        unit: node.type === 'MEASUREMENT' ? node.config.unit : null,
        tolerance:
          node.type === 'MEASUREMENT'
            ? `±${node.config.tolerance_positive}${node.config.unit}`
            : null,
        expected_entity:
          node.type === 'VERIFICATION' ? node.config.entity_name : null,
        timestamp: successEvent?.timestamp?.toISOString() ?? null,
        deviations,
      };
    });

    // YOLO operator summary from latest snapshot context
    const yolo = snapshot.context.yoloState;

    return {
      run_id: id,
      sop_id: run.sopId,
      status: run.status,
      started_at: startedAt.toISOString(),
      completed_at: completedAt?.toISOString() ?? null,
      duration_seconds: durationSeconds,
      total_steps: validatedDag.nodes.length,
      passed_steps: snapshot.context.completedNodes.length,
      failed_steps: snapshot.context.deviations.length,
      pending_steps:
        validatedDag.nodes.length - snapshot.context.completedNodes.length,
      operator_summary: {
        peak_people_count: yolo?.peopleCount ?? 0,
        second_verifier_present: yolo?.secondVerifier ?? false,
        ppe_status: yolo?.ppeStatus ?? 'UNKNOWN',
        last_activity: yolo?.processActivity ?? 'UNKNOWN',
      },
      steps: stepRows,
      deviations: snapshot.context.deviations,
      events_count: events.length,
    };
  }
}
