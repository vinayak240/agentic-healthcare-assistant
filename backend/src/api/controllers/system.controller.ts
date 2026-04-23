import { Controller, Get } from '@nestjs/common';
import { SystemService } from '../services';

@Controller('system')
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  @Get('health')
  getHealth() {
    return this.systemService.getHealth();
  }
}
