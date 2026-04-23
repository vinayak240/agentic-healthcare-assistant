import { Injectable } from '@nestjs/common';

@Injectable()
export class SystemService {
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
