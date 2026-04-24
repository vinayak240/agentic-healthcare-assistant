import { Injectable, Optional } from '@nestjs/common';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';

interface UploadObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
}

@Injectable()
export class MinioStorageService {
  private client: S3Client | null = null;
  private bucketReady = false;
  private readonly logger: LoggerService;

  constructor(
    private readonly configService: ConfigService,
    @Optional() logger: LoggerService = new LoggerService(),
  ) {
    this.logger = logger.child({
      component: MinioStorageService.name,
    });
  }

  async uploadObject(input: UploadObjectInput): Promise<void> {
    await this.ensureBucket();

    try {
      await this.getClient().send(
        new PutObjectCommand({
          Bucket: this.getBucket(),
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
        }),
      );
    } catch (error) {
      this.logger.error('minio.object.upload_failed', {
        stage: 'storage',
        operation: 'upload_object',
        status: 'failed',
        bucket: this.getBucket(),
        key: input.key,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : 'Unknown MinIO upload error',
      });

      throw error;
    }
  }

  async createPresignedReadUrl(key: string): Promise<string> {
    await this.ensureBucket();

    return getSignedUrl(
      this.getClient(),
      new GetObjectCommand({
        Bucket: this.getBucket(),
        Key: key,
      }),
      { expiresIn: 60 * 60 },
    );
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) {
      return;
    }

    const bucket = this.getBucket();
    const client = this.getClient();

    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (headError) {
      this.logger.warn('minio.bucket.head_failed', {
        stage: 'storage',
        operation: 'head_bucket',
        status: 'warning',
        bucket,
        errorName: headError instanceof Error ? headError.name : 'UnknownError',
        errorMessage: headError instanceof Error ? headError.message : 'Unknown MinIO bucket error',
      });

      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (createError) {
        this.logger.error('minio.bucket.create_failed', {
          stage: 'storage',
          operation: 'create_bucket',
          status: 'failed',
          bucket,
          errorName: createError instanceof Error ? createError.name : 'UnknownError',
          errorMessage: createError instanceof Error ? createError.message : 'Unknown MinIO bucket error',
        });

        throw createError;
      }

      this.logger.info('minio.bucket.created', {
        stage: 'storage',
        operation: 'create_bucket',
        status: 'completed',
        bucket,
      });
    }

    this.bucketReady = true;
  }

  private getClient(): S3Client {
    if (!this.client) {
      this.client = new S3Client({
        endpoint: this.configService.get('S3_ENDPOINT') ?? 'http://localhost:9000',
        region: this.configService.get('S3_REGION') ?? 'us-east-1',
        forcePathStyle: this.parseBoolean(this.configService.get('S3_FORCE_PATH_STYLE') ?? 'true'),
        credentials: {
          accessKeyId: this.configService.get('S3_ACCESS_KEY') ?? 'admin',
          secretAccessKey: this.configService.get('S3_SECRET_KEY') ?? 'admin123',
        },
      });
    }

    return this.client;
  }

  private getBucket(): string {
    return this.configService.get('S3_BUCKET') ?? 'chat-audio';
  }

  private parseBoolean(value: string): boolean {
    return ['1', 'true', 'yes'].includes(value.toLowerCase());
  }
}
