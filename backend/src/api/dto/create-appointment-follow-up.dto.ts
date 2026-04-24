import { IsMongoId, IsOptional, IsString } from 'class-validator';

export class CreateAppointmentFollowUpDto {
  @IsMongoId()
  runId!: string;

  @IsOptional()
  @IsString()
  specialty?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  doctorName?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
