import { IsString, Matches, IsNotEmpty } from 'class-validator';

export class CreateMpesaExpressDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^2547\d{8}$/, { message: 'Phone number must be in the format 2547XXXXXXXX' })
  phoneNumber: string;

  @IsString()
  @Matches(/^[a-zA-Z0-9]{1,12}$/, { message: 'Account reference must be alphanumeric and not more than 12 characters' })
  accountRef: string;

  amount: number;
}
