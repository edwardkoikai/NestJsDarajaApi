import { Controller, Post, Body, Logger, HttpException, HttpStatus, Get } from '@nestjs/common';
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
            CallbackMetadata?: {
                Item: Array<{
                    Name: string;
                    Value: string | number;
                }>;
            };
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
    ) {
        this.redis = this.redisService.getOrThrow();
        this.logger.log('MpesaController initialized');
    }
    @Get('/test-callback')
    testCallback() {
        this.logger.debug('Test callback endpoint reached');
        return { status: 'success' };
    }

    @Post('/stkpush')
    async initiateSTKPush(@Body() createMpesaExpressDto: CreateMpesaExpressDto) {
        this.logger.debug('=== Starting STK Push Request ===');
        this.logger.debug(`Request payload: ${JSON.stringify(createMpesaExpressDto, null, 2)}`);

        try {
            const result = await this.mpesaService.stkPush(createMpesaExpressDto);
            this.logger.debug(`STK Push successful: ${JSON.stringify(result, null, 2)}`);

            return {
                success: true,
                data: result,
            };
        } catch (error) {
            this.logger.error('=== STK Push Failed ===');
            this.logger.error(`Error message: ${error.message}`);
            this.logger.error(`Stack trace: ${error.stack}`);

            throw new HttpException({
                status: HttpStatus.INTERNAL_SERVER_ERROR,
                error: 'Failed to initiate payment',
                details: error.message
            }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    

    @Post('/callback')
    async handleSTKCallback(@Body() callback: STKCallback) {
        this.logger.debug('=== M-Pesa Callback Received ===');
        this.logger.debug(`Callback payload: ${JSON.stringify(callback, null, 2)}`);

        try {
            // Validate callback structure
            if (!callback?.Body?.stkCallback) {
                this.logger.error('Invalid callback structure received');
                throw new HttpException('Invalid callback data', HttpStatus.BAD_REQUEST);
            }

            const { ResultCode, ResultDesc, CheckoutRequestID } = callback.Body.stkCallback;
            this.logger.debug(`Processing callback for CheckoutRequestID: ${CheckoutRequestID}`);
            this.logger.debug(`Result Code: ${ResultCode}, Description: ${ResultDesc}`);

            // Process the callback
            await this.mpesaService.processCallback(callback);
            
            this.logger.debug('=== Callback Processing Completed ===');

            // Always return success to M-Pesa
            return {
                ResultCode: 0,
                ResultDesc: "Success"
            };
        } catch (error) {
            this.logger.error('=== Callback Processing Failed ===');
            this.logger.error(`Error message: ${error.message}`);
            this.logger.error(`Stack trace: ${error.stack}`);

            // Even if processing fails, we should return success to M-Pesa
            // but log the error for our tracking
            return {
                ResultCode: 0,
                ResultDesc: "Success"
            };
        }
    }
}