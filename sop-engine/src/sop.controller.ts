// src/sop.controller.ts
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';

@Controller('api/sop')
export class SopController {
  @Post('templates')
  @HttpCode(HttpStatus.CREATED)
  createTemplate(@Body() payload: any) {
    console.log('\n=============================================');
    console.log('   RECEIVED NEW WORKFLOW FROM FRONTEND CANVAS ');
    console.log('=============================================');
    console.log(JSON.stringify(payload, null, 2));
    console.log('=============================================\n');

    return {
      status: 'saved',
      id: payload.template_id,
      timestamp: new Date().toISOString(),
    };
  }
}