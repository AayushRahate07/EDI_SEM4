/* eslint-disable */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ◄ CRITICAL: Enable Cross-Origin Resource Sharing
  app.enableCors({
    origin: '*', // Allows your frontend interface dev server to securely talk to the engine
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
