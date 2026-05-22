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

  // ── GET /runs/active — Latest active run (used by CV service auto-attach) ────
  @Get('active')
  async getActiveRun() {
    const run = await this.prisma.client.workflowRun.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    if (!run) throw new NotFoundException('No active workflow run found.');
    return { run_id: run.id, sop_id: run.sopId, status: run.status };
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
    const activeNodeId = oldSnapshot.context.currentNodeId;
    if (eventPayload.payload && typeof eventPayload.payload === 'object') {
      eventPayload.payload.nodeId = activeNodeId;
    }

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
      if (newSnapshot.status === 'done') {
        this.generateAndSaveReportFile(id).catch((err) =>
          console.error('[Engine] generateAndSaveReportFile error:', err),
        );
      }
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
  async getReportRoute(@Param('id') id: string) {
    return this.getReport(id, false);
  }

  async getReport(id: string, skipSave = false) {
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
      const successEvent = events.find((e) => {
        if (e.eventType !== 'EXECUTE_STEP' || e.validationResult !== 'PASS') return false;
        try {
          const p = JSON.parse(e.payloadJson);
          return p.nodeId === node.id || (p.nodeId === undefined && snapshot.context.completedNodes.includes(node.id));
        } catch {
          return false;
        }
      });
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

    const reportData = {
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

    if (run.status === 'COMPLETED' && !skipSave) {
      this.generateAndSaveReportFile(id).catch((err) =>
        console.error('[Engine] generateAndSaveReportFile error:', err),
      );
    }

    return reportData;
  }

  private async generateAndSaveReportFile(id: string) {
    try {
      const fs = require('fs');
      const path = require('path');

      const reportData = await this.getReport(id, true);

      // Create reports directory in the root of the workspace
      const rootDir = path.resolve(__dirname, '..', '..', '..');
      const reportsDir = path.join(rootDir, 'reports');

      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }

      // 1. Save JSON report
      const jsonPath = path.join(reportsDir, `report_${id}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(reportData, null, 2), 'utf-8');
      console.log(`[Engine] Saved JSON Compliance Report to ${jsonPath}`);

      // 2. Save HTML report
      const htmlPath = path.join(reportsDir, `report_${id}.html`);
      const htmlContent = this.buildHtmlReport(reportData);
      fs.writeFileSync(htmlPath, htmlContent, 'utf-8');
      console.log(`[Engine] Saved HTML Compliance Report to ${htmlPath}`);
    } catch (e) {
      console.error(`[Engine] Failed to save compliance report files: ${e}`);
    }
  }

  private buildHtmlReport(report: any): string {
    const formatTime = (iso: string | null) => {
      if (!iso) return "—";
      try {
        return new Date(iso).toLocaleString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        });
      } catch {
        return iso;
      }
    };

    const formatDur = (s: number) => {
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return `${m}m ${sec}s`;
    };

    const isCompleted = report.status === 'COMPLETED';
    const statusClass = isCompleted ? 'status-completed' : 'status-deviation';
    
    let tableRows = '';
    report.steps.forEach((step: any, i: number) => {
      const isPass = step.status === 'PASS';
      const resultClass = isPass ? 'result-pass' : 'result-fail';
      const valueStr = step.submitted_value != null 
        ? (typeof step.submitted_value === 'number' ? `${step.submitted_value}${step.unit ?? ""}` : String(step.submitted_value))
        : "—";
      const targetStr = step.target_value != null
        ? `${step.target_value}${step.unit ?? ""} ${step.tolerance ?? ""}`
        : step.expected_entity ?? "—";
      const typeStr = step.type === 'VERIFICATION' ? 'VERIFY' : 'MEASURE';
      const typeClass = step.type === 'VERIFICATION' ? 'type-verify' : 'type-measure';

      tableRows += `
        <tr style="background: ${i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.01)'}">
          <td style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #3a4055; padding: 11px 14px; border-bottom: 1px solid #1c2130;">${i + 1}</td>
          <td style="font-size: 13px; color: #d4d8e8; font-weight: 500; padding: 11px 14px; border-bottom: 1px solid #1c2130;">${step.title}</td>
          <td style="padding: 11px 14px; border-bottom: 1px solid #1c2130;">
            <span class="type-badge ${typeClass}">${typeStr}</span>
          </td>
          <td style="font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #8890a8; padding: 11px 14px; border-bottom: 1px solid #1c2130;">${valueStr}</td>
          <td style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #565d75; padding: 11px 14px; border-bottom: 1px solid #1c2130;">${targetStr}</td>
          <td style="padding: 11px 14px; border-bottom: 1px solid #1c2130;">
            <span class="result-badge ${resultClass}">${step.status}</span>
          </td>
          <td style="font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #3a4055; padding: 11px 14px; border-bottom: 1px solid #1c2130;">${formatTime(step.timestamp)}</td>
        </tr>
      `;
    });

    let deviationsSection = '';
    if (report.deviations.length > 0) {
      deviationsSection += `
        <div class="deviations-card">
          <div class="deviations-title">⚠ DEVIATION RECORDS (${report.deviations.length})</div>
      `;
      report.deviations.forEach((d: any) => {
        deviationsSection += `
          <div class="deviation-item">
            <span style="font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #4b5563; flex-shrink: 0;">[${formatTime(d.timestamp)}]</span>
            <span style="font-size: 12px; color: #fca5a5;">${d.issue}</span>
            <span style="font-size: 11px; color: #565d75; margin-left: auto; flex-shrink: 0;">Step: ${d.stepId}</span>
          </div>
        `;
      });
      deviationsSection += `</div>`;
    }

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Batch Compliance Report - ${report.sop_id}</title>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    body {
      background-color: #060810;
      color: #d4d8e8;
      font-family: 'DM Sans', sans-serif;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 1100px;
      margin: 0 auto;
      padding: 40px 32px;
    }
    .header-card {
      background: #0e1117;
      border: 1px solid #1c2130;
      border-radius: 12px;
      padding: 28px 32px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .title-sub {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 10px;
      color: #4b5563;
      text-transform: uppercase;
      letter-spacing: .12em;
      margin-bottom: 8px;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
      color: #fff;
      letter-spacing: .02em;
    }
    .run-id {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 11px;
      color: #565d75;
      margin-top: 6px;
    }
    .status-badge {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: .08em;
      border-radius: 6px;
      padding: 8px 18px;
    }
    .status-completed {
      color: #2dd4a0;
      background: #0a2620;
      border: 1px solid #1a4a38;
    }
    .status-deviation {
      color: #ef4444;
      background: #1a0808;
      border: 1px solid #6b2230;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 20px;
    }
    .stat-card {
      background: #0e1117;
      border: 1px solid #1c2130;
      border-radius: 10px;
      padding: 20px;
    }
    .stat-label {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 9px;
      color: #4b5563;
      text-transform: uppercase;
      letter-spacing: .1em;
      margin-bottom: 8px;
    }
    .stat-value {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 26px;
      font-weight: 700;
    }
    .details-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 20px;
    }
    .details-card {
      background: #0e1117;
      border: 1px solid #1c2130;
      border-radius: 10px;
      padding: 18px 20px;
    }
    .details-title {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 10px;
      color: #4b5563;
      text-transform: uppercase;
      letter-spacing: .1em;
      margin-bottom: 12px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 13px;
    }
    .detail-label {
      color: #4b5563;
    }
    .detail-value {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 11px;
      color: #8890a8;
    }
    .audit-table-card {
      background: #0e1117;
      border: 1px solid #1c2130;
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 20px;
    }
    .table-header {
      background: #090a0f;
      border-bottom: 1px solid #1c2130;
      padding: 14px 20px;
    }
    .table-title {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 10px;
      font-weight: 600;
      color: #4b5563;
      text-transform: uppercase;
      letter-spacing: .1em;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      padding: 10px 14px;
      text-align: left;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 9px;
      color: #4b5563;
      text-transform: uppercase;
      letter-spacing: .08em;
      font-weight: 600;
      border-bottom: 1px solid #1c2130;
    }
    td {
      padding: 11px 14px;
      font-size: 13px;
      border-bottom: 1px solid #1c2130;
    }
    .type-badge {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 9px;
      padding: 2px 7px;
      border-radius: 3px;
    }
    .type-verify {
      background: #0a2620;
      color: #2dd4a0;
      border: 1px solid #1a4a38;
    }
    .type-measure {
      background: #0a1830;
      color: #4da6ff;
      border: 1px solid #1a3060;
    }
    .result-badge {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 9px;
      font-weight: 700;
      padding: 3px 9px;
      border-radius: 3px;
    }
    .result-pass {
      color: #2dd4a0;
      background: #0a2620;
      border: 1px solid #1a4a38;
    }
    .result-fail {
      color: #ef4444;
      background: #1a0808;
      border: 1px solid #6b2230;
    }
    .deviations-card {
      background: #1a0808;
      border: 1px solid #7f1d1d;
      border-radius: 10px;
      padding: 20px 24px;
      margin-bottom: 20px;
    }
    .deviations-title {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 10px;
      font-weight: 600;
      color: #ef4444;
      text-transform: uppercase;
      letter-spacing: .1em;
      margin-bottom: 14px;
    }
    .deviation-item {
      display: flex;
      gap: 12px;
      margin-bottom: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid #3d0f0f;
    }
    .deviation-item:last-child {
      border-bottom: none;
      margin-bottom: 0;
      padding-bottom: 0;
    }
    .footer {
      text-align: center;
      padding-top: 20px;
      border-top: 1px solid #1c2130;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 10px;
      color: #3a4055;
    }
    @media print {
      body { background: #fff !important; color: #000 !important; }
      .container { padding: 20px 0; }
      .header-card, .stat-card, .details-card, .audit-table-card, .deviations-card {
        background: #fff !important;
        border: 1px solid #ccc !important;
        color: #000 !important;
      }
      h1, .stat-value, td, th { color: #000 !important; }
      .status-badge, .type-badge, .result-badge {
        background: #fff !important;
        border: 1px solid #000 !important;
        color: #000 !important;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header-card">
      <div>
        <div class="title-sub">Batch Compliance Report</div>
        <h1>${report.sop_id}</h1>
        <div class="run-id">Run ID: ${report.run_id}</div>
      </div>
      <div class="status-badge ${statusClass}">
        ${report.status}
      </div>
    </div>

    <!-- Summary stats -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Steps</div>
        <div class="stat-value" style="color: #d4d8e8;">${report.total_steps}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Passed</div>
        <div class="stat-value" style="color: #2dd4a0;">${report.passed_steps}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Deviations</div>
        <div class="stat-value" style="color: ${report.failed_steps > 0 ? '#ef4444' : '#2dd4a0'};">${report.failed_steps}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Duration</div>
        <div class="stat-value" style="color: #8890a8;">${formatDur(report.duration_seconds)}</div>
      </div>
    </div>

    <!-- Timing & Operator Info -->
    <div class="details-grid">
      <div class="details-card">
        <div class="details-title">Timestamps</div>
        <div class="detail-row">
          <span class="detail-label">Started</span>
          <span class="detail-value">${formatTime(report.started_at)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Completed</span>
          <span class="detail-value">${formatTime(report.completed_at)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Duration</span>
          <span class="detail-value">${formatDur(report.duration_seconds)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Events Logged</span>
          <span class="detail-value">${report.events_count}</span>
        </div>
      </div>

      <div class="details-card">
        <div class="details-title">Operator Summary (CV)</div>
        <div class="detail-row">
          <span class="detail-label">People Detected</span>
          <span class="detail-value" style="color: ${report.operator_summary.peak_people_count >= 1 ? '#2dd4a0' : '#ef4444'}">
            ${report.operator_summary.peak_people_count}
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Second Verifier</span>
          <span class="detail-value" style="color: ${report.operator_summary.second_verifier_present ? '#2dd4a0' : '#ef4444'}">
            ${report.operator_summary.second_verifier_present ? 'YES' : 'NO'}
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">PPE Compliance</span>
          <span class="detail-value" style="color: ${report.operator_summary.ppe_status === 'PASS' ? '#2dd4a0' : '#ef4444'}">
            ${report.operator_summary.ppe_status}
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Last Activity</span>
          <span class="detail-value" style="color: #2dd4a0;">${report.operator_summary.last_activity}</span>
        </div>
      </div>
    </div>

    <!-- Step Audit Table -->
    <div class="audit-table-card">
      <div class="table-header">
        <span class="table-title">Step-by-Step Audit</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Step</th>
            <th>Type</th>
            <th>Submitted Value</th>
            <th>Target</th>
            <th>Result</th>
            <th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>

    <!-- Deviations Section -->
    ${deviationsSection}

    <!-- Footer -->
    <div class="footer">
      Generated by SOP Compliance Engine · ${new Date().toLocaleString()} · Run ${report.run_id}
    </div>
  </div>
</body>
</html>
    `;
  }
}
