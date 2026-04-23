import { Controller, Get, Param } from '@nestjs/common';
import { RunIdParamDto } from '../dto';
import { RunService } from '../services';

@Controller('runs')
export class RunController {
  constructor(private readonly runService: RunService) {}

  @Get(':id')
  getRun(@Param() params: RunIdParamDto) {
    return this.runService.getRun(params.id);
  }
}
