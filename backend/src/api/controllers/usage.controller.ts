import { Controller, Get, Param, Query } from '@nestjs/common';
import { RunIdParamDto, UsageRangeQueryDto, UserUsageParamDto } from '../dto';
import { UsageService } from '../services';

@Controller('usage')
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @Get('run/:id')
  getRunUsage(@Param() params: RunIdParamDto) {
    return this.usageService.getRunUsage(params.id);
  }

  @Get('user/:userId')
  getUserUsage(@Param() params: UserUsageParamDto, @Query() query: UsageRangeQueryDto) {
    return this.usageService.getUserUsage({
      userId: params.userId,
      from: query.from,
      to: query.to,
    });
  }
}
