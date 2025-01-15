import { Module } from '@nestjs/common';
import { MpesaService } from './service/mpesa.service';
import { MpesaController } from './controller/mpesa.controller';

@Module({
    controllers: [MpesaController],
    providers: [MpesaService],
    exports: [MpesaService]
})
export class MpesaModule {}
