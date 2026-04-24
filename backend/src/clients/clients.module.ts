import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { OpenAiService } from './openai/openai.service';
import { MinioStorageService } from './storage/minio-storage.service';

@Module({
  imports: [ConfigModule],
  providers: [OpenAiService, MinioStorageService],
  exports: [OpenAiService, MinioStorageService],
})
export class ClientsModule {}
