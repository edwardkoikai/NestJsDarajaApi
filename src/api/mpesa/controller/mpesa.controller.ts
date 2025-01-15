import { Controller, Post, Body, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { MpesaService } from '../service/mpesa.service';
import { Transaction } from '../entities/transaction.entity';
import { AuthService } from '../service/auth.service';
import { Redis } from 'ioredis';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { CreateMpesaExpressDto } from '../dto/create-mpesa-express.dto';

interface STKCallback {
    Body: {
        stkCallback: {
            MerchantRequestID: string;
            CheckoutRequestID: string;
            ResultCode: number;
            ResultDesc: string;
        };
    };
}
@Controller('mpesa')
export class MpesaController {
    private readonly logger = new Logger(MpesaController.name);
    private readonly redis: Redis;

    constructor(
        private readonly mpesaService: MpesaService,
        private readonly redisService: RedisService,
    ) {this.redis = this.redisService.getOrThrow();}

    @Post('/stkpush')
    async initiateSTKPush(@Body() createMpesaExpressDto: CreateMpesaExpressDto) {
        try {
            const result = await this.mpesaService.stkPush(createMpesaExpressDto);
            return {
                success: true,
                data: result,
            };
        } catch (error) {
            this.logger.error(`STK Push failed: ${error.message}`);
            throw new HttpException('Failed to initiate payment', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post('/callback')
    async handleSTKCallback(@Body() callback: STKCallback) {
        return this.mpesaService.processCallback(callback);
    }
}
