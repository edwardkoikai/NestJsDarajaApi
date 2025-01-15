import { Injectable, HttpException, Logger } from '@nestjs/common';
import { CreateMpesaExpressDto } from '../dto/create-mpesa-express.dto';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { InjectRepository } from '@nestjs/typeorm';
import { Transaction } from '../entities/transaction.entity';
import { Repository } from 'typeorm';
import axios from 'axios';
import { Status } from '../enums/transaction-status.enum'


interface MpesaConfig {
    shortcode: string;
    passkey: string;
    callbackUrl: string;
    transactionType: string;
}
interface AxiosErrorResponse {
    response?: {
      data?: any;
      status?: number;
    };
    message: string;
  }

interface STKPushRequest {
    BusinessShortCode: string;
    Password: string;
    Timestamp: string;
    TransactionType: string;
    Amount: number;
    PartyA: string;
    PartyB: string;
    PhoneNumber: string;
    CallBackURL: string;
    AccountReference: string;
    TransactionDesc: string;
}

interface TransactionCache {
    CheckoutRequestID: string;
    MerchantRequestID: string;
    Amount: number;
    PhoneNumber: string;
    status: Status
}
interface STKPushResponse {
    CheckoutRequestID: string;
    MerchantRequestID: string;
    ResponseCode: string;
    ResponseDescription: string;
    CustomerMessage: string;
}
interface TransactionData {
    MerchantRequestID: string;
    CheckoutRequestID: string;
    ResultCode: string;
    ResultDesc: string;
    Amount: number;
    MpesaReceiptNumber: string;
    Balance: number;
    TransactionDate: Date;
    PhoneNumber: string;
    status: Status;
}
@Injectable()
export class MpesaService {
    private readonly logger = new Logger(MpesaService.name);
    private readonly mpesaConfig: MpesaConfig;
    private readonly redis: Redis;

    constructor(
        @InjectRepository(Transaction) private readonly transactionRepository: Repository<Transaction>,    
        private readonly authService: AuthService,
        private readonly configService: ConfigService,
        private readonly redisService: RedisService,
    ) {
        this.mpesaConfig = {
            shortcode: '174379',
            passkey: this.configService.get<string>('PASS_KEY'),
            callbackUrl: 'https://goose-merry-mollusk.ngrok-free.app/api/mpesa/callback',
            transactionType: 'CustomerPayBillOnline',
        };
        this.redis = this.redisService.getOrThrow();
    }

    async stkPush(dto: CreateMpesaExpressDto): Promise<any> {
        try {
            await this.validateDto(dto);

            const token = await this.getAuthToken();
            const timestamp = this.generateTimestamp();
            const password = this.generatePassword(timestamp);

            const requestBody = this.createSTKPushRequest(dto, timestamp, password);
            const response = await this.sendSTKPushRequest(requestBody, token);
            const stkResponse = response.data as STKPushResponse;

            await this.cacheInitialTransaction({
              CheckoutRequestID: stkResponse.CheckoutRequestID,
              MerchantRequestID: stkResponse.MerchantRequestID,
              Amount: dto.amount,
              PhoneNumber: dto.phoneNumber,
              status: Status.PENDING,
           });

            return response.data;
        } catch (error) {
            this.handleError(error);
        }
    }

    async processCallback(callbackData: any): Promise<void> {
        try {
            this.logger.debug(`Callback data received: ${JSON.stringify(callbackData)}`);
            
            const { stkCallback } = callbackData.Body;
            const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback;
    
            this.logger.debug(`Processing callback for CheckoutRequestID: ${CheckoutRequestID}`);
            const cachedTransaction = await this.getCachedTransaction(CheckoutRequestID);
    
            if (!cachedTransaction) {
                this.logger.error(`Transaction not found in cache for CheckoutRequestID: ${CheckoutRequestID}`);
                throw new HttpException('Transaction not found in cache', 404);
            }
    
            const metadata = this.extractCallbackMetadata(CallbackMetadata?.Item || []);
            const transactionData: TransactionData = {
                MerchantRequestID: stkCallback.MerchantRequestID,
                CheckoutRequestID,
                ResultCode,
                ResultDesc,
                Amount: cachedTransaction.Amount,
                MpesaReceiptNumber: metadata.MpesaReceiptNumber || '',
                Balance: metadata.Balance || 0,
                TransactionDate: new Date(metadata.TransactionDate || Date.now()),
                PhoneNumber: cachedTransaction.PhoneNumber,
                status: ResultCode === '0' ? Status.COMPLETED : Status.FAILED,
            };
    
            this.logger.debug(`Saving transaction to database: ${JSON.stringify(transactionData)}`);
            await this.saveTransactionToDatabase(transactionData);
    
            await this.redis.del(CheckoutRequestID);
            this.logger.debug(`Transaction processed and cache cleared for CheckoutRequestID: ${CheckoutRequestID}`);
        } catch (error) {
            this.logger.error(`Callback processing failed: ${error.message}`);
            throw new HttpException('Failed to process callback', 500);
        }
    }
    

    private async getCachedTransaction(checkoutRequestId: string): Promise<TransactionCache | null> {
        const cached = await this.redis.get(checkoutRequestId);
        return cached ? JSON.parse(cached) : null;
    }

    private extractCallbackMetadata(items: any[]): Record<string, any> {
        return items.reduce((acc, item) => ({ ...acc, [item.Name]: item.Value }), {});
    }

    private async saveTransactionToDatabase(transactionData: any): Promise<void> {
        try {
            const transaction = new Transaction();
            transaction.transactionId = transactionData.MerchantRequestID;
            transaction.amount = transactionData.Amount;
            transaction.phoneNumber = transactionData.PhoneNumber;
            transaction.status = transactionData.status;
            transaction.MerchantRequestID = transactionData.MerchantRequestID;
            transaction.CheckoutRequestID = transactionData.CheckoutRequestID;
            transaction.resultCode = transactionData.ResultCode;
            transaction.resultDesc = transactionData.ResultDesc;
    
            await this.transactionRepository.save(transaction);
            this.logger.debug(`Transaction saved to database: ${transactionData.CheckoutRequestID}`);
        } catch (error) {
            this.logger.error(`Database error: ${error.message}`);
            throw new HttpException('Failed to save transaction', 500);
        }
    }

    private async cacheInitialTransaction(transactionData: TransactionCache): Promise<void> {
        try {
            await this.redis.setex(
                transactionData.CheckoutRequestID,
                3600, // 1 hour expiry
                JSON.stringify(transactionData),
            );
        } catch (error) {
            this.logger.error(`Error caching transaction: ${error}`);
            throw new HttpException('Failed to cache transaction', 500);
        }
    }

    private validateDto(dto: CreateMpesaExpressDto): void {
        const validations = [
            {
                condition: !dto.phoneNum.match(/^2547\d{8}$/),
                message: 'Phone number must be in the format 2547XXXXXXXX',
            },
            {
                condition: !dto.accountRef.match(/^[a-zA-Z0-9]{1,12}$/),
                message: 'Account reference must be alphanumeric and not more than 12 characters',
            },
            {
                condition: dto.amount <= 0,
                message: 'Amount must be greater than 0',
            },
        ];

        const failure = validations.find((validation) => validation.condition);
        if (failure) {
            this.logger.error(`Validation failed: ${failure.message}`);
            throw new HttpException(failure.message, 400);
        }
    }

    private generateTimestamp(): string {
        const date = new Date();
        const pad = (num: number) => num.toString().padStart(2, '0');

        return (
            `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
            `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
        );
    }

    private generatePassword(timestamp: string): string {
        const { shortcode, passkey } = this.mpesaConfig;
        return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
    }

    private async getAuthToken(): Promise<string> {
        const token = await this.authService.generateToken();
        if (!token) {
            throw new HttpException('Failed to generate token, please check your environment variables', 401);
        }
        return token;
    }

    private createSTKPushRequest(dto: CreateMpesaExpressDto, timestamp: string, password: string): STKPushRequest {
        const { shortcode, transactionType, callbackUrl } = this.mpesaConfig;

        return {
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: transactionType,
            Amount: dto.amount,
            PartyA: dto.phoneNumber,
            PartyB: shortcode,
            PhoneNumber: dto.phoneNumber,
            CallBackURL: callbackUrl,
            AccountReference: dto.accountRef,
            TransactionDesc: 'szken',
        };
    }

    private async sendSTKPushRequest(requestBody: STKPushRequest, token: string) {
        return axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', requestBody, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });
    }

    private handleError(error: unknown): never {
        if (error instanceof HttpException) {
            throw error;
        }
    
        // Type check for axios error
        if (error && typeof error === 'object' && 'response' in error) {
            const axiosError = error as AxiosErrorResponse;
            this.logger.error(`API Error: ${axiosError.message}`, axiosError.response?.data);
            throw new HttpException(
                `Failed to process payment: ${axiosError.message}`, 
                axiosError.response?.status || 500
            );
        }
    
        // For other types of errors
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        this.logger.error(`Unexpected error: ${errorMessage}`);
        throw new HttpException('Internal server error', 500);
    }
}
