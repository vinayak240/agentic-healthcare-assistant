import { Injectable } from '@nestjs/common';

@Injectable()
export class AgentService {
  runAgentLoop() {
    return {
      status: 'idle',
    };
  }
}
