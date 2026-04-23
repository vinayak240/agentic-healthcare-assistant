import { Injectable } from '@nestjs/common';
import { UsersRepository } from '../../dal/repositories/users.repository';
import type {
  PatientContextToolInput,
  PatientContextToolOutput,
  ToolDefinition,
} from '../tool.types';

@Injectable()
export class PatientContextTool
  implements ToolDefinition<PatientContextToolInput, PatientContextToolOutput>
{
  readonly name = 'patient_context';
  readonly description = 'Fetches structured patient allergies, conditions, and medical history.';
  readonly inputType = 'PatientContextToolInput';
  readonly outputType = 'PatientContextToolOutput';
  readonly inputSchema = {
    type: 'object',
    required: ['userId'],
    properties: {
      userId: { type: 'string' },
    },
  };

  constructor(private readonly usersRepository: UsersRepository) {}

  async execute(input: PatientContextToolInput): Promise<PatientContextToolOutput> {
    const user = await this.usersRepository.findById(input.userId);

    if (!user) {
      throw new Error('User not found');
    }

    return {
      userId: user._id.toString(),
      allergies: this.normalizeList(user.allergies),
      medicalConditions: this.normalizeList(user.medicalConditions),
      medicalHistory: this.normalizeList(user.medicalHistory),
    };
  }

  private normalizeList(values: string[] | undefined): string[] {
    return Array.isArray(values)
      ? values
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : [];
  }
}
