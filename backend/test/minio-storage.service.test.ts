import { describe, expect, it } from 'bun:test';
import { MinioStorageService } from '../src/clients/storage/minio-storage.service';
import { ConfigService } from '../src/config/config.service';

class TestConfigService extends ConfigService {
  constructor(private readonly values: Record<string, string>) {
    super();
  }

  override get(key: string): string | undefined {
    return this.values[key];
  }
}

describe('MinioStorageService', () => {
  it('uses the public endpoint when creating presigned read URLs', async () => {
    const service = new MinioStorageService(
      new TestConfigService({
        S3_ENDPOINT: 'http://minio:9000',
        S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
        S3_REGION: 'us-east-1',
        S3_FORCE_PATH_STYLE: 'true',
        S3_ACCESS_KEY: 'admin',
        S3_SECRET_KEY: 'admin123',
        S3_BUCKET: 'chat-audio',
      }),
    );

    (service as unknown as { bucketReady: boolean }).bucketReady = true;

    const url = await service.createPresignedReadUrl('conversations/123/chunk-000.mp3');

    expect(url).toStartWith('http://localhost:9000/chat-audio/conversations/123/chunk-000.mp3?');
    expect(url).not.toContain('minio:9000');
  });
});
