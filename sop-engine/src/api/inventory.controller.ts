import { Controller, Get, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma.service';

// In-memory store for the last NFC scan — resets on server restart
let lastScan: { uid: string; timestamp: number } | null = null;

@Controller('api')
export class InventoryController {
  constructor(private readonly prisma: PrismaService) {}

  // ── GET /api/inventory — list all registered items ───────────────────────────
  @Get('inventory')
  async getAllItems() {
    return this.prisma.client.inventoryItem.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  // ── POST /api/inventory/register — register NFC tag to material ───────────────
  @Post('inventory/register')
  async registerItem(@Body() body: {
    nfcUid: string;
    name: string;
    batchNo?: string;
    expiryDate?: string;
    yoloClass?: string;
  }) {
    if (!body.nfcUid || !body.name) {
      throw new HttpException('nfcUid and name are required', HttpStatus.BAD_REQUEST);
    }
    return this.prisma.client.inventoryItem.create({
      data: {
        nfcUid: body.nfcUid.toUpperCase(),
        name: body.name,
        batchNo: body.batchNo || null,
        expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
        yoloClass: body.yoloClass?.toLowerCase() || null,
      }
    });
  }

  // ── GET /api/hardware/last-scan — last scanned UID ────────────────────────────
  @Get('hardware/last-scan')
  getLastScan() {
    return lastScan ?? { uid: '', timestamp: 0 };
  }

  // ── POST /api/hardware/scan — called by nfc-bridge ───────────────────────────
  // Returns item info if registered, or status: UNREGISTERED (never 404)
  @Post('hardware/scan')
  async scanItem(@Body() body: { uid: string }) {
    if (!body.uid) {
      throw new HttpException('NFC UID is required', HttpStatus.BAD_REQUEST);
    }

    // Always capture the UID so the registration page can auto-fill
    const normalisedUid = body.uid.toUpperCase();
    lastScan = { uid: normalisedUid, timestamp: Date.now() };

    const item = await this.prisma.client.inventoryItem.findUnique({
      where: { nfcUid: normalisedUid }
    });

    // Unregistered tag — return gracefully so nfc-bridge doesn't crash
    if (!item) {
      return {
        uid: normalisedUid,
        status: 'UNREGISTERED',
        message: `UID ${normalisedUid} is not registered. Go to /admin/inventory to register it.`
      };
    }

    const isExpired = item.expiryDate && new Date() > item.expiryDate;

    return {
      uid: normalisedUid,
      id: item.id,
      name: item.name,
      batchNo: item.batchNo,
      expiryDate: item.expiryDate,
      yoloClass: item.yoloClass,
      status: isExpired ? 'EXPIRED' : 'ACTIVE',
      message: isExpired
        ? `WARNING: ${item.name} (Batch: ${item.batchNo}) has expired!`
        : `Verified: ${item.name}${item.batchNo ? ` · Batch ${item.batchNo}` : ''}`
    };
  }
}
