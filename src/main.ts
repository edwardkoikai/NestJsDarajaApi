import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {cors: true, logger: ['error', 'verbose', 'debug', 'log', 'warn']});
  
  const config = new DocumentBuilder()
  . setTitle('Safaricom Daraja Api')
  .setDescription('Safaricom Daraja  API description')
  .setVersion('1.0')
  .addTag('Daraja Api')
  .build()
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  const port = process.env.PORT || 3000;
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, documentFactory);

  await app.listen(port);
  Logger.log(`Application is running on: http://localhost:${port}/${globalPrefix}`);



}
bootstrap();
