import { Controller, Get, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma.service';

// In-memory store for the last NFC scan — resets on server restart
let lastScan: { uid: string; timestamp: number } | null = null;

@Controller('api')
export class InventoryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('inventory')
  async getAllItems() {
    return this.prisma.client.inventoryItem.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  @Post('inventory/register')
  async registerItem(@Body() body: { nfcUid: string; name: string; batchNo?: string; expiryDate?: string }) {
    if (!body.nfcUid || !body.name) {
      throw new HttpException('nfcUid and name are required', HttpStatus.BAD_REQUEST);
    }
    return this.prisma.client.inventoryItem.create({
      data: {
        nfcUid: body.nfcUid,
        name: body.name,
        batchNo: body.batchNo,
        expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
      }
    });
  }

  @Get('hardware/last-scan')
  getLastScan() {
    return lastScan ?? { uid: '', timestamp: 0 };
  }

  @Post('hardware/scan')
  async scanItem(@Body() body: { uid: string }) {
    if (!body.uid) {
      throw new HttpException('NFC UID is required', HttpStatus.BAD_REQUEST);
    }

    // Always capture the raw UID so the registration page can poll and auto-fill
    lastScan = { uid: body.uid.toUpperCase(), timestamp: Date.now() };
    const normalisedUid = lastScan.uid; // Use the uppercased version for DB lookup

    const item = await this.prisma.client.inventoryItem.findUnique({
      where: { nfcUid: normalisedUid }
    });

    if (!item) {
      throw new HttpException('Item not found in inventory', HttpStatus.NOT_FOUND);
    }

    const isExpired = item.expiryDate && new Date() > item.expiryDate;

    return {
      ...item,
      status: isExpired ? 'EXPIRED' : 'ACTIVE',
      message: isExpired ? 'WARNING: This item has expired!' : 'Item verified.'
    };
  }
}
