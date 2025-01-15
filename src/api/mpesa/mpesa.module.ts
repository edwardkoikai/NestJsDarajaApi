import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MpesaService } from './service/mpesa.service';
import { MpesaController } from './controller/mpesa.controller';
import { Transaction } from './entities/transaction.entity';
import { AuthService } from './service/auth.service';

@Module({
    imports: [TypeOrmModule.forFeature([Transaction])],
    controllers: [MpesaController],
    providers: [MpesaService, AuthService],
    exports: [MpesaService]
})
export class MpesaModule {}
