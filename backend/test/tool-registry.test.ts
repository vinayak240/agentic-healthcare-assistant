import { describe, expect, it } from 'bun:test';
import { ToolRegistry } from '../src/tool/tool.registry';
import { ToolService } from '../src/tool/tool.service';
import { BookAppointmentTool } from '../src/tool/tools/book-appointment.tool';
import { DrugInfoTool } from '../src/tool/tools/drug-info.tool';
import { PatientContextTool } from '../src/tool/tools/patient-context.tool';

describe('Tool registry', () => {
  it('registers the v1 tools with stable descriptors', () => {
    const patientContextTool = new PatientContextTool({
      async findById() {
        return {
          _id: { toString: () => '507f1f77bcf86cd799439011' },
          allergies: [],
          medicalConditions: [],
          medicalHistory: [],
        };
      },
    } as never);
    const drugInfoTool = new DrugInfoTool(
      patientContextTool,
      {
        async createJsonResponse() {
          return {
            content:
              '{"suggestions":[{"title":"Rest","type":"home_remedy","note":"Rest may help you recover."}],"redFlags":[],"reasoningSummary":"Suggestions were limited to general symptom relief and safety checks."}',
            totalTokens: 42,
          };
        },
      } as never,
    );
    const bookAppointmentTool = new BookAppointmentTool();
    const toolService = new ToolService(
      new ToolRegistry(),
      patientContextTool,
      drugInfoTool,
      bookAppointmentTool,
    );

    expect(toolService.listTools()).toEqual([
      {
        name: 'patient_context',
        description: 'Fetches structured patient allergies, conditions, and medical history.',
        inputType: 'PatientContextToolInput',
        outputType: 'PatientContextToolOutput',
        inputSchema: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string' },
          },
        },
      },
      {
        name: 'drug_info',
        description:
          'Generates safe, non-prescriptive symptom-relief suggestions based on symptoms and patient context.',
        inputType: 'DrugInfoToolInput',
        outputType: 'DrugInfoToolOutput',
        inputSchema: {
          type: 'object',
          required: ['userId', 'symptoms'],
          properties: {
            userId: { type: 'string' },
            symptoms: { type: 'string' },
          },
        },
      },
      {
        name: 'book_appointment',
        description: 'Returns curated doctor contact options for human follow-up.',
        inputType: 'BookAppointmentToolInput',
        outputType: 'BookAppointmentToolOutput',
        inputSchema: {
          type: 'object',
          properties: {
            specialty: { type: 'string' },
            reason: { type: 'string' },
          },
        },
      },
    ]);
  });

  it('patient context tool returns normalized profile fields', async () => {
    const tool = new PatientContextTool({
      async findById() {
        return {
          _id: { toString: () => '507f1f77bcf86cd799439011' },
          allergies: [' Penicillin ', ''],
          medicalConditions: [' Asthma '],
          medicalHistory: [' Childhood migraines '],
        };
      },
    } as never);

    await expect(tool.execute({ userId: '507f1f77bcf86cd799439011' })).resolves.toEqual({
      userId: '507f1f77bcf86cd799439011',
      allergies: ['Penicillin'],
      medicalConditions: ['Asthma'],
      medicalHistory: ['Childhood migraines'],
    });
  });

  it('drug info tool returns a safe fallback for risky symptoms', async () => {
    const patientContextTool = new PatientContextTool({
      async findById() {
        return {
          _id: { toString: () => '507f1f77bcf86cd799439011' },
          allergies: [],
          medicalConditions: [],
          medicalHistory: [],
        };
      },
    } as never);
    const tool = new DrugInfoTool(
      patientContextTool,
      {
        async createJsonResponse() {
          throw new Error('OpenAI should not be called for emergency symptoms');
        },
      } as never,
    );

    await expect(
      tool.execute({
        userId: '507f1f77bcf86cd799439011',
        symptoms: 'I have chest pain and shortness of breath',
      }),
    ).resolves.toEqual({
      suggestions: [],
      redFlags: ['Please seek urgent medical care or contact emergency services.'],
      reasoningSummary: 'Symptoms may need urgent medical attention.',
    });
  });

  it('drug info tool drops invalid JSON responses to an empty safe fallback', async () => {
    const patientContextTool = new PatientContextTool({
      async findById() {
        return {
          _id: { toString: () => '507f1f77bcf86cd799439011' },
          allergies: ['ibuprofen'],
          medicalConditions: ['asthma'],
          medicalHistory: [],
        };
      },
    } as never);
    const tool = new DrugInfoTool(
      patientContextTool,
      {
        async createJsonResponse() {
          return {
            content: '{"not":"valid"}',
            totalTokens: 18,
          };
        },
      } as never,
    );

    await expect(
      tool.execute({
        userId: '507f1f77bcf86cd799439011',
        symptoms: 'mild headache',
      }),
    ).resolves.toEqual({
      suggestions: [],
      redFlags: [],
      reasoningSummary: 'No safe symptom-relief suggestions were available.',
    });
  });

  it('book appointment tool returns human follow-up contacts', async () => {
    const tool = new BookAppointmentTool();

    await expect(tool.execute({ specialty: 'General Medicine' })).resolves.toEqual({
      status: 'human_follow_up_required',
      contacts: [
        {
          doctorName: 'Dr. Anita Patel',
          specialty: 'General Medicine',
          phone: '+1-555-0101',
          availabilityNote: 'Weekdays 9am-5pm',
        },
      ],
    });
  });
});
