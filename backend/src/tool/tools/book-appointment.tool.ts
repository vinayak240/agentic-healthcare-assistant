import { Injectable } from '@nestjs/common';
import type {
  BookAppointmentContact,
  BookAppointmentToolInput,
  BookAppointmentToolOutput,
  ToolDefinition,
} from '../tool.types';

const DOCTOR_CONTACTS: BookAppointmentContact[] = [
  {
    doctorName: 'Dr. Anita Patel',
    specialty: 'General Medicine',
    phone: '+1-555-0101',
    availabilityNote: 'Weekdays 9am-5pm',
  },
  {
    doctorName: 'Dr. Marcus Chen',
    specialty: 'Internal Medicine',
    phone: '+1-555-0102',
    availabilityNote: 'Same-day urgent consult slots may be available',
  },
  {
    doctorName: 'Dr. Sofia Ramirez',
    specialty: 'Family Medicine',
    phone: '+1-555-0103',
    availabilityNote: 'Good option for non-emergency follow-up care',
  },
];

@Injectable()
export class BookAppointmentTool
  implements ToolDefinition<BookAppointmentToolInput, BookAppointmentToolOutput>
{
  readonly name = 'book_appointment';
  readonly description = 'Returns curated doctor contact options for human follow-up.';
  readonly inputType = 'BookAppointmentToolInput';
  readonly outputType = 'BookAppointmentToolOutput';
  readonly inputSchema = {
    type: 'object',
    properties: {
      specialty: { type: 'string' },
      reason: { type: 'string' },
    },
  };

  async execute(input: BookAppointmentToolInput): Promise<BookAppointmentToolOutput> {
    const specialty = input.specialty?.trim().toLowerCase();
    const reason = input.reason?.trim().toLowerCase();
    const contacts = DOCTOR_CONTACTS.filter((contact) => {
      if (!specialty && !reason) {
        return true;
      }

      const searchableText = `${contact.specialty} ${contact.availabilityNote ?? ''}`.toLowerCase();
      const matchesSpecialty = specialty ? searchableText.includes(specialty) : false;
      const matchesReason = reason ? searchableText.includes(reason) : false;

      return matchesSpecialty || matchesReason;
    });

    return {
      status: 'human_follow_up_required', //will handle this at UI
      contacts: contacts.length > 0 ? contacts : DOCTOR_CONTACTS,
    };
  }
}
