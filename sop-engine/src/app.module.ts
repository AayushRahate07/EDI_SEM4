import { Module } from '@nestjs/common';
import { WorkflowController } from './api/workflow.controller';
import { PersistenceModule } from './persistence/persistence.module';
import { SopController } from './sop.controller'; // ◄ 1. IMPORT IT HERE

@Module({
  imports: [PersistenceModule],
  controllers: [
    WorkflowController,
    SopController, // ◄ 2. ADD IT TO THIS ARRAY
  ],
  providers: [],
})
export class AppModule {}
