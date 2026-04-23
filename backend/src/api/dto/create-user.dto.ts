import { Type } from 'class-transformer';
import { IsArray, IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsOptional()
  @IsArray()
  @Type(() => String)
  @IsString({ each: true })
  allergies?: string[];

  @IsOptional()
  @IsArray()
  @Type(() => String)
  @IsString({ each: true })
  medicalConditions?: string[];

  @IsOptional()
  @IsArray()
  @Type(() => String)
  @IsString({ each: true })
  medicalHistory?: string[];
}
