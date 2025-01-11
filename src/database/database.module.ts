import { Global, Module } from '@nestjs/common';
import { databaseProvider } from './database.provider';
import { DataSource } from 'typeorm';

@Global()
@Module({
    imports: [],
    providers: databaseProvider,
    exports: [DataSource]
})

export class DatabaseModule {}
