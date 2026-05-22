/* eslint-disable */
// src/persistence/run.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { createActor } from 'xstate';
import { compileDagToMachine } from '../engine/workflow.compiler';
import { SopDag } from '../schemas/sop.schema';

@Injectable()
export class RunRepository {
  constructor(private prisma: PrismaService) {}

  async initializeRun(
    runId: string,
    sopId: string,
    initialNodeId: string,
    emptySnapshot: string,
  ) {
    // Added .client wrapper reference
    return this.prisma.client.workflowRun.create({
      data: {
        id: runId,
        sopId,
        status: 'ACTIVE',
        currentState: initialNodeId,
        snapshotJson: emptySnapshot,
      },
    });
  }

  async saveEngineState(
    runId: string,
    actorState: any,
    validationResult: 'PASS' | 'DEVIATION',
    rawEvent: any,
  ) {
    const context = actorState.context;
    const isCompleted = actorState.status === 'done';

    // Added .client wrapper reference to transaction and nested calls
    await this.prisma.client.$transaction([
      this.prisma.client.workflowRun.update({
        where: { id: runId },
        data: {
          currentState: context.currentNodeId,
          status: isCompleted ? 'COMPLETED' : 'ACTIVE',
          snapshotJson: JSON.stringify(actorState),
        },
      }),
      this.prisma.client.runEvent.create({
        data: {
          runId,
          eventType: rawEvent.type,
          payloadJson: JSON.stringify(rawEvent.payload),
          validationResult: validationResult,
        },
      }),
    ]);
  }

  async rehydrateActor(runId: string, dag: SopDag) {
    // Added .client wrapper reference
    const runRecord = await this.prisma.client.workflowRun.findUniqueOrThrow({
      where: { id: runId },
    });

    const machine = compileDagToMachine(dag, runId);

    const actor = createActor(machine, {
      snapshot: JSON.parse(runRecord.snapshotJson),
    });

    actor.start();
    return actor;
  }
}
