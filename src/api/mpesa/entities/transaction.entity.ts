import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Status } from '../enums/transaction-status.enum';

@Entity('transactions')
export class Transaction {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    transactionId: string;

    @Column()
    MerchantRequestID: string;

    @Column()
    CheckoutRequestID: string;

    @Column()
    resultCode: string;

    @Column()
    resultDesc: string;

    @Column('decimal')
    amount: number;

    @Column()
    phoneNumber: string;

    @Column()
    status: Status

    @Column({ nullable: true })
    mpesaReceiptNumber: string;

    @Column({ type: 'timestamp', nullable: true })
    transactionDate: Date;

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    balance: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}