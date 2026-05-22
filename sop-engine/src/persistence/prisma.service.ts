// src/persistence/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  // ◄ Keep your original client wrapper property intact
  public client: PrismaClient;

  constructor() {
    const adapter = new PrismaBetterSqlite3({
      url: 'file:./prisma/dev.db',
    });

    this.client = new PrismaClient({ adapter });
  }

  async onModuleInit() {
    await this.client.$connect(); // ◄ This resolves the missing $connect error
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
