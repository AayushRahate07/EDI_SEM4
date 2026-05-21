import { Module } from '@nestjs/common';
import { WorkflowController } from './api/workflow.controller';
import { PersistenceModule } from './persistence/persistence.module';
import { SopController } from './sop.controller'; // ◄ 1. IMPORT IT HERE
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [PersistenceModule],
  controllers: [
    WorkflowController,
    SopController, // ◄ 2. ADD IT TO THIS ARRAY
    AppController,
  ],
  providers: [AppService],
})
export class AppModule {}
