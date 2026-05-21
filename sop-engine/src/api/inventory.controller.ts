import { Controller, Get, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma.service';

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

  @Post('hardware/scan')
  async scanItem(@Body() body: { uid: string }) {
    if (!body.uid) {
      throw new HttpException('NFC UID is required', HttpStatus.BAD_REQUEST);
    }

    const item = await this.prisma.client.inventoryItem.findUnique({
      where: { nfcUid: body.uid }
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
