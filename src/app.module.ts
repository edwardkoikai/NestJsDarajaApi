import { MiddlewareConsumer, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import * as dotenv from 'dotenv';
import { DatabaseModule } from './database/database.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ApiModule } from './api/api.module';
import { RedisModule } from '@liaoliaots/nestjs-redis';
import { LoggerMiddleware } from './logger/logger.middleware';

dotenv.config();

@Module({
  imports: [
    ConfigModule.forRoot({isGlobal: true}),
    RedisModule.forRootAsync({
      useFactory: (configService: ConfigService) => configService.get('REDIS_URL'),
      inject: [ConfigService],
  }), 
    DatabaseModule,
    ApiModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
      consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
