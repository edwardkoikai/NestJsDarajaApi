import { Module } from "@nestjs/common";
import { MpesaModule } from "src/mpesa/mpesa.module";

@Module({
    // import all your modules here
    imports: [
        MpesaModule
    ]
})

export class ApiModule{}