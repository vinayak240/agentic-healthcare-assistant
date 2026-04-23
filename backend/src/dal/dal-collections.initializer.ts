import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

@Injectable()
export class DalCollectionsInitializer implements OnModuleInit {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async onModuleInit(): Promise<void> {
    await Promise.all(
      Object.values(this.connection.models).map((model) =>
        model.createCollection(),
      ),
    );
  }
}
