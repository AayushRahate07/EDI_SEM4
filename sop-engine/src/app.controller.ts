import { Module } from '@nestjs/common';
import { WorkflowController } from './api/workflow.controller';
import { SopController } from './sop.controller';
import { PersistenceModule } from './persistence/persistence.module';

@Module({
  imports: [PersistenceModule],
  controllers: [WorkflowController, SopController],
  providers: [],
})
export class AppModule {}
