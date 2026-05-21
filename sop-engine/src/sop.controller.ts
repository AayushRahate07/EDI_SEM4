// src/sop.controller.ts
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { PrismaService } from './persistence/prisma.service';
import { SopDagSchema } from './schemas/sop.schema';

@Controller('api/sop')
export class SopController {
  constructor(private prisma: PrismaService) {}

  @Post('templates')
  @HttpCode(HttpStatus.CREATED)
  async createTemplate(@Body() payload: any) {
    console.log('\n=============================================');
    console.log('   PERSISTING WORKFLOW FROM FRONTEND CANVAS ');
    console.log('=============================================');

    // 1. Validate against Zod schema to ensure shape compliance
    const validated = SopDagSchema.parse(payload);

    // 2. Perform database persistence in a transaction
    await this.prisma.client.$transaction(async (tx) => {
      // Clear out existing template blueprint to enable clean overwrite updates
      await tx.sopTemplate.deleteMany({
        where: { templateId: validated.template_id }
      });

      // Save the main template entry
      await tx.sopTemplate.create({
        data: {
          templateId: validated.template_id,
          version: validated.version,
          startNodeId: validated.start_node_id,
        }
      });

      // Save each individual node & build a UI-to-DB ID mapping map
      const uiIdToDbIdMap = new Map<string, string>();
      for (const node of validated.nodes) {
        const dbNode = await tx.sopNode.create({
          data: {
            idFromUi: node.id,
            templateId: validated.template_id,
            type: node.type,
            title: node.title,
            x: (node as any).x !== undefined ? Number((node as any).x) : 0,
            y: (node as any).y !== undefined ? Number((node as any).y) : 0,
            config: JSON.stringify(node.config),
          }
        });
        uiIdToDbIdMap.set(node.id, dbNode.id);
      }

      // Save transitions/edges between nodes
      for (const node of validated.nodes) {
        const fromNodeDbId = uiIdToDbIdMap.get(node.id);
        if (!fromNodeDbId) continue;

        if (node.type === 'DECISION_BRANCH') {
          for (const [condition, targetUiId] of Object.entries(node.next_nodes)) {
            const toNodeDbId = uiIdToDbIdMap.get(targetUiId);
            if (toNodeDbId) {
              await tx.sopTransition.create({
                data: {
                  fromNodeId: fromNodeDbId,
                  toNodeId: toNodeDbId,
                  condition,
                }
              });
            }
          }
        } else {
          for (const targetUiId of node.next_nodes) {
            if (targetUiId === 'WORKFLOW_COMPLETE') continue;
            const toNodeDbId = uiIdToDbIdMap.get(targetUiId);
            if (toNodeDbId) {
              await tx.sopTransition.create({
                data: {
                  fromNodeId: fromNodeDbId,
                  toNodeId: toNodeDbId,
                  condition: 'DEFAULT',
                }
              });
            }
          }
        }
      }
    });

    console.log(`Successfully persisted template: ${validated.template_id}`);
    console.log('=============================================\n');

    return {
      status: 'saved',
      id: validated.template_id,
      timestamp: new Date().toISOString(),
    };
  }
}