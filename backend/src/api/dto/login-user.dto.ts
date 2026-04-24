import { IsEmail, MaxLength } from 'class-validator';

export class LoginUserDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;
}
