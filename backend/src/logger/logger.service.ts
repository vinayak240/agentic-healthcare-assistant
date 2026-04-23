import { Injectable } from '@nestjs/common';

@Injectable()
export class LoggerService {
  log(message: string, ...optionalParams: unknown[]): void {
    console.log(message, ...optionalParams);
  }
}
