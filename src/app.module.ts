import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import * as dotenv from 'dotenv';
import { DatabaseModule } from './database/database.module';
import { ConfigModule } from '@nestjs/config';
import { ApiModule } from './api/api.module';

dotenv.config();

@Module({
  imports: [
    ConfigModule.forRoot({isGlobal: true}), 
    DatabaseModule,
    ApiModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
