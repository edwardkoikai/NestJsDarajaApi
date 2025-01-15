import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('transactions')
export class Transaction {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    transactionId: string;

    @Column()
    amount: number;

    @Column()
    phoneNumber: string;

    @Column()
    status: string;

    @Column()
    MerchantRequestID: string;

    @Column()
    CheckoutRequestID: string;

    @Column()
    resultCode: number;

    @Column()
    resultDesc: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}