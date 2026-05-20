import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RunRepository } from './run.repository';

@Global() // Makes the persistence layers visible throughout our NestJS dependency tree
@Module({
  providers: [PrismaService, RunRepository],
  exports: [PrismaService, RunRepository],
})
export class PersistenceModule {}