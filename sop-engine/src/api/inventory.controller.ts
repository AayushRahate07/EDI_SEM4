/* eslint-disable */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../persistence/prisma.service';

// In-memory store for the last NFC scan — resets on server restart
let lastScan: { uid: string; timestamp: number } | null = null;

// CV service URL
const CV_SERVICE_URL = process.env.CV_SERVICE_URL || 'http://localhost:8001';

/**
 * Returns:
 *   null  — CV service unreachable (network error / timeout)
 *   []    — CV online but no relevant objects detected in frame
 *   [...]  — CV online with detected object names
 */
async function fetchCvDetectedObjects(): Promise<string[] | null> {
  try {
    const res = await fetch(`${CV_SERVICE_URL}/status`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return (data?.yolo?.detectedObjects ?? []).map((o: string) =>
      o.toLowerCase(),
    );
  } catch {
    return null; // null = genuinely unreachable (timeout / connection refused)
  }
}

@Controller('api')
export class InventoryController {
  constructor(private readonly prisma: PrismaService) {}

  // ── GET /api/inventory — list all registered items ───────────────────────────
  @Get('inventory')
  async getAllItems() {
    return this.prisma.client.inventoryItem.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── POST /api/inventory/register — register NFC tag to material ───────────────
  @Post('inventory/register')
  async registerItem(
    @Body()
    body: {
      nfcUid: string;
      name: string;
      batchNo?: string;
      expiryDate?: string;
      yoloClass?: string;
    },
  ) {
    if (!body.nfcUid || !body.name) {
      throw new HttpException(
        'nfcUid and name are required',
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      return await this.prisma.client.inventoryItem.create({
        data: {
          nfcUid: body.nfcUid.toUpperCase(),
          name: body.name,
          batchNo: body.batchNo || null,
          expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
          yoloClass: body.yoloClass?.toLowerCase() || null,
        },
      });
    } catch (err: any) {
      // P2002 = unique constraint violation (NFC UID already registered)
      if (err?.code === 'P2002') {
        throw new HttpException(
          `NFC tag ${body.nfcUid.toUpperCase()} is already registered. Tap a different tag or delete the existing entry first.`,
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }

  // ── PATCH /api/inventory/:id — update an existing inventory item ──────────────
  @Patch('inventory/:id')
  async updateItem(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      batchNo?: string;
      expiryDate?: string;
      yoloClass?: string;
    },
  ) {
    const existing = await this.prisma.client.inventoryItem.findUnique({ where: { id } });
    if (!existing) {
      throw new HttpException(`Inventory item ${id} not found`, HttpStatus.NOT_FOUND);
    }
    try {
      return await this.prisma.client.inventoryItem.update({
        where: { id },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.batchNo !== undefined && { batchNo: body.batchNo || null }),
          ...(body.expiryDate !== undefined && {
            expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
          }),
          ...(body.yoloClass !== undefined && {
            yoloClass: body.yoloClass?.toLowerCase() || null,
          }),
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new HttpException(
          'That NFC UID is already assigned to another item.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }

  // ── DELETE /api/inventory/:id — remove an inventory item ─────────────────────
  @Delete('inventory/:id')
  async deleteItem(@Param('id') id: string) {
    const existing = await this.prisma.client.inventoryItem.findUnique({ where: { id } });
    if (!existing) {
      throw new HttpException(`Inventory item ${id} not found`, HttpStatus.NOT_FOUND);
    }
    await this.prisma.client.inventoryItem.delete({ where: { id } });
    return { success: true, deleted: id };
  }

  // ── GET /api/hardware/last-scan — last scanned UID ────────────────────────────
  @Get('hardware/last-scan')
  getLastScan() {
    return lastScan ?? { uid: '', timestamp: 0 };
  }

  // ── POST /api/hardware/scan — called by nfc-bridge ───────────────────────────
  // Dual-gate verification:
  //   Gate 1 — NFC UID must match a registered, non-expired inventory item
  //   Gate 2 — If item has a yoloClass, that object must be visible in camera
  @Post('hardware/scan')
  async scanItem(@Body() body: { uid: string }) {
    if (!body.uid) {
      throw new HttpException('NFC UID is required', HttpStatus.BAD_REQUEST);
    }

    const normalisedUid = body.uid.toUpperCase();
    lastScan = { uid: normalisedUid, timestamp: Date.now() };

    const item = await this.prisma.client.inventoryItem.findUnique({
      where: { nfcUid: normalisedUid },
    });

    // ── Gate 1a: Unregistered tag ────────────────────────────────────────────
    if (!item) {
      return {
        uid: normalisedUid,
        status: 'UNREGISTERED',
        message: `UID ${normalisedUid} is not registered. Go to /admin/inventory to register it.`,
      };
    }

    // ── Gate 1b: Expired material ────────────────────────────────────────────
    const isExpired = item.expiryDate && new Date() > item.expiryDate;
    if (isExpired) {
      return {
        uid: normalisedUid,
        id: item.id,
        name: item.name,
        batchNo: item.batchNo,
        yoloClass: item.yoloClass,
        status: 'EXPIRED',
        cvCheckResult: 'SKIPPED',
        message: `WARNING: ${item.name} (Batch: ${item.batchNo}) has expired!`,
      };
    }

    // ── Gate 2: YOLO object presence check ──────────────────────────────────
    // Only runs if this inventory item has a registered yoloClass.
    // Result is advisory — a soft-fail warns but does NOT block the scan.
    let cvCheckResult: 'PASS' | 'FAIL' | 'SKIPPED' | 'CV_OFFLINE' | 'CV_SOFT_FAIL' = 'SKIPPED';
    let cvMessage = '';

    if (item.yoloClass) {
      const detectedObjects = await fetchCvDetectedObjects();

      if (detectedObjects === null) {
        // null = genuine network failure — CV unreachable, allow with warning
        cvCheckResult = 'CV_OFFLINE';
        cvMessage = ' (CV service offline — visual check skipped)';
      } else {
        const objectInFrame = detectedObjects.includes(
          item.yoloClass.toLowerCase(),
        );

        if (objectInFrame) {
          cvCheckResult = 'PASS';
          cvMessage = ` · ${item.yoloClass} confirmed in camera ✓`;
        } else {
          // Soft-fail: warn but still allow — camera angle may be off
          cvCheckResult = 'CV_SOFT_FAIL';
          cvMessage = ` · WARNING: "${item.yoloClass}" not visible in camera (detected: ${detectedObjects.length > 0 ? detectedObjects.join(', ') : 'nothing'})`;
        }
      }
    }

    // ── Both gates passed ────────────────────────────────────────────────────
    return {
      uid: normalisedUid,
      id: item.id,
      name: item.name,
      batchNo: item.batchNo,
      expiryDate: item.expiryDate,
      yoloClass: item.yoloClass,
      status: 'ACTIVE',
      cvCheckResult,
      message: `Verified: ${item.name}${item.batchNo ? ` · Batch ${item.batchNo}` : ''}${cvMessage}`,
    };
  }
}
