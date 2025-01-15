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
            callbackUrl: 'https://f136-102-167-44-224.ngrok-free.app/api/mpesa/callback',
            transactionType: 'CustomerPayBillOnline',
        };
        this.redis = this.redisService.getOrThrow();
    }

    async stkPush(dto: CreateMpesaExpressDto): Promise<any> {
        try {
            this.logger.debug(`Starting STK push for phone: ${dto.phoneNumber}`);
            await this.validateDto(dto);

            const token = await this.getAuthToken();
            this.logger.debug('Auth token generated successfully');

            const timestamp = this.generateTimestamp();
            const password = this.generatePassword(timestamp);

            const requestBody = this.createSTKPushRequest(dto, timestamp, password);
            this.logger.debug(`STK push request body: ${JSON.stringify(requestBody)}`);

            const response = await this.sendSTKPushRequest(requestBody, token);
            this.logger.debug(`STK push response: ${JSON.stringify(response.data)}`);

            const stkResponse = response.data as STKPushResponse;

            // Log before caching
            this.logger.debug(`Attempting to cache transaction: ${JSON.stringify({
                CheckoutRequestID: stkResponse.CheckoutRequestID,
                MerchantRequestID: stkResponse.MerchantRequestID,
                Amount: dto.amount,
                PhoneNumber: dto.phoneNumber,
                status: Status.PENDING,
            })}`);

            await this.cacheInitialTransaction({
                CheckoutRequestID: stkResponse.CheckoutRequestID,
                MerchantRequestID: stkResponse.MerchantRequestID,
                Amount: dto.amount,
                PhoneNumber: dto.phoneNumber,
                status: Status.PENDING,
            });

            this.logger.debug('Transaction cached successfully');
            return response.data;
        } catch (error) {
            this.logger.error(`STK push failed: ${error.message}`);
            this.handleError(error);
        }
    }

    async processCallback(callbackData: any): Promise<void> {
        try {
            this.logger.debug('=== Starting Callback Processing ===');
            this.logger.debug(`Raw callback data: ${JSON.stringify(callbackData, null, 2)}`);
            
            const { stkCallback } = callbackData.Body;
            this.logger.debug(`STK Callback data: ${JSON.stringify(stkCallback, null, 2)}`);
    
            const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback;
            
            const cachedTransaction = await this.getCachedTransaction(CheckoutRequestID);
            this.logger.debug(`Cached transaction data: ${JSON.stringify(cachedTransaction, null, 2)}`);
    
            if (!cachedTransaction) {
                this.logger.error(`Transaction not found in cache for CheckoutRequestID: ${CheckoutRequestID}`);
                throw new HttpException('Transaction not found in cache', 404);
            }
    
            const metadata = this.extractCallbackMetadata(CallbackMetadata?.Item || []);
            this.logger.debug(`Extracted metadata: ${JSON.stringify(metadata, null, 2)}`);
    
            const transactionData: TransactionData = {
                MerchantRequestID: stkCallback.MerchantRequestID,
                CheckoutRequestID,
                ResultCode,
                ResultDesc,
                Amount: cachedTransaction.Amount,
                MpesaReceiptNumber: metadata.MpesaReceiptNumber || '',
                Balance: metadata.Balance || 0,
                TransactionDate: metadata.TransactionDate,
                PhoneNumber: cachedTransaction.PhoneNumber,
                // Set status based on ResultCode (0 means success)
                status: ResultCode === 0 ? Status.COMPLETED : Status.FAILED,
            };
    
            this.logger.debug(`Prepared transaction data: ${JSON.stringify(transactionData, null, 2)}`);
            await this.saveTransactionToDatabase(transactionData);
            
            await this.redis.del(CheckoutRequestID);
            this.logger.debug('=== Callback Processing Completed Successfully ===');
        } catch (error) {
            this.logger.error('=== Callback Processing Failed ===');
            this.logger.error(`Error details: ${error.message}`);
            this.logger.error(`Stack trace: ${error.stack}`);
            throw new HttpException('Failed to process callback', 500);
        }
    }
    

    private async getCachedTransaction(checkoutRequestId: string): Promise<TransactionCache | null> {
        const cached = await this.redis.get(checkoutRequestId);
        return cached ? JSON.parse(cached) : null;
    }

    private extractCallbackMetadata(items: any[]): Record<string, any> {
        const metadata = items.reduce((acc, item) => ({ ...acc, [item.Name]: item.Value }), {});
        
        // Parse the transaction date correctly
        if (metadata.TransactionDate) {
            const dateStr = metadata.TransactionDate.toString();
            // Format: YYYYMMDDHHmmss
            const year = dateStr.substring(0, 4);
            const month = dateStr.substring(4, 6);
            const day = dateStr.substring(6, 8);
            const hour = dateStr.substring(8, 10);
            const minute = dateStr.substring(10, 12);
            const second = dateStr.substring(12, 14);
            
            metadata.TransactionDate = new Date(
                `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`
            );
        }
        
        return metadata;
    }

    private async saveTransactionToDatabase(transactionData: TransactionData): Promise<void> {
        try {
            const transaction = this.transactionRepository.create({
                transactionId: transactionData.MerchantRequestID,
                amount: transactionData.Amount,
                phoneNumber: transactionData.PhoneNumber,
                status: transactionData.status,
                MerchantRequestID: transactionData.MerchantRequestID,
                CheckoutRequestID: transactionData.CheckoutRequestID,
                resultCode: transactionData.ResultCode.toString(),
                resultDesc: transactionData.ResultDesc,
                mpesaReceiptNumber: transactionData.MpesaReceiptNumber,
                transactionDate: transactionData.TransactionDate,
                balance: transactionData.Balance || 0
            });
    
            const savedTransaction = await this.transactionRepository.save(transaction);
            this.logger.debug(`Transaction saved to database with ID: ${savedTransaction.transactionId}`);
        } catch (error) {
            this.logger.error(`Database error: ${error.message}`);
            this.logger.error(`Failed transaction data: ${JSON.stringify(transactionData, null, 2)}`);
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
                condition: !dto.phoneNumber.match(/^2547\d{8}$/),
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
