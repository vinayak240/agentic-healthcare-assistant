import { OpenAiService } from '../../clients/openai/openai.service';
import { Injectable } from '@nestjs/common';
import type {
  DrugInfoSuggestion,
  DrugInfoToolInput,
  DrugInfoToolOutput,
  ToolDefinition,
} from '../tool.types';
import { PatientContextTool } from './patient-context.tool';

const EMERGENCY_PATTERN =
  /\b(chest pain|shortness of breath|difficulty breathing|stroke|seizure|passed out|fainted|suicidal|overdose|severe bleeding|anaphylaxis|allergic reaction)\b/i;
const DOSAGE_PATTERN =
  /\b\d+\s?(mg|mcg|g|ml|tablet|tablets|capsule|capsules|pills?|drops?)\b|\b(once|twice|every\s+\d+)\b/i;
const PRESCRIPTIVE_PATTERN =
  /\b(prescribe|prescription|diagnose|diagnosis|definitive treatment|must take|should take|start taking|antibiotic|steroid)\b/i;

@Injectable()
export class DrugInfoTool implements ToolDefinition<DrugInfoToolInput, DrugInfoToolOutput> {
  readonly name = 'drug_info';
  readonly description =
    'Generates safe, non-prescriptive symptom-relief suggestions based on symptoms and patient context.';
  readonly inputType = 'DrugInfoToolInput';
  readonly outputType = 'DrugInfoToolOutput';
  readonly inputSchema = {
    type: 'object',
    required: ['userId', 'symptoms'],
    properties: {
      userId: { type: 'string' },
      symptoms: { type: 'string' },
    },
  };

  constructor(
    private readonly patientContextTool: PatientContextTool,
    private readonly openAiService: OpenAiService,
  ) {}

  async execute(input: DrugInfoToolInput): Promise<DrugInfoToolOutput> {
    const symptoms = input.symptoms.trim();

    if (symptoms.length < 3) {
      return this.createFallback('Symptoms are unclear, so no suggestions were returned.');
    }

    if (EMERGENCY_PATTERN.test(symptoms)) {
      return this.createFallback(
        'Symptoms may need urgent medical attention.',
        ['Please seek urgent medical care or contact emergency services.'],
      );
    }

    const patientContext = await this.patientContextTool.execute({ userId: input.userId });
    const prompt = [
      'You are a healthcare support tool.',
      'Your task is to provide safe, non-prescriptive suggestions for symptom relief.',
      '',
      'STRICT RULES:',
      '- Do NOT prescribe medication',
      '- Do NOT provide dosage',
      '- Do NOT give definitive treatment',
      '- Only suggest commonly used OTC or general remedies',
      '- Use phrases like "may help", "commonly used", or "you could consider"',
      '- If symptoms are unclear or risky, return empty suggestions',
      '- Consider allergies and conditions',
      '- Avoid suggesting anything conflicting with allergies or conditions',
      '',
      'OUTPUT FORMAT (STRICT JSON ONLY):',
      JSON.stringify({
        suggestions: [
          {
            title: 'string',
            type: 'otc',
            note: 'string',
          },
        ],
        redFlags: ['string'],
        reasoningSummary: 'string',
      }),
      '',
      `PATIENT_CONTEXT=${JSON.stringify(patientContext)}`,
      `SYMPTOMS=${JSON.stringify(symptoms)}`,
    ].join('\n');
    const completion = await this.openAiService.createJsonResponse(prompt);

    return this.sanitizeResponse(completion.content, patientContext);
  }

  private sanitizeResponse(
    rawContent: string,
    patientContext: {
      allergies: string[];
      medicalConditions: string[];
      medicalHistory: string[];
    },
  ): DrugInfoToolOutput {
    if (!rawContent) {
      return this.createFallback('No safe symptom-relief suggestions were available.');
    }

    let parsed: Record<string, unknown>;

    try {
      parsed = JSON.parse(rawContent) as Record<string, unknown>;
    } catch {
      return this.createFallback('Unable to validate symptom-relief suggestions safely.');
    }

    const patientTerms = [
      ...patientContext.allergies,
      ...patientContext.medicalConditions,
      ...patientContext.medicalHistory,
    ]
      .map((term) => term.trim().toLowerCase())
      .filter((term) => term.length > 0);
    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
          .map((suggestion) => this.sanitizeSuggestion(suggestion, patientTerms))
          .filter((suggestion): suggestion is DrugInfoSuggestion => suggestion !== null)
      : [];
    const redFlags = Array.isArray(parsed.redFlags)
      ? parsed.redFlags
          .filter((flag): flag is string => typeof flag === 'string')
          .map((flag) => flag.trim())
          .filter((flag) => flag.length > 0)
      : [];
    const reasoningSummary = this.sanitizeReasoningSummary(parsed.reasoningSummary);

    if (suggestions.length === 0 && redFlags.length === 0) {
      return this.createFallback('No safe symptom-relief suggestions were available.');
    }

    return {
      suggestions,
      redFlags,
      reasoningSummary,
    };
  }

  private sanitizeSuggestion(
    suggestion: unknown,
    patientTerms: string[],
  ): DrugInfoSuggestion | null {
    if (!suggestion || typeof suggestion !== 'object') {
      return null;
    }

    const candidate = suggestion as Record<string, unknown>;
    const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
    const note = typeof candidate.note === 'string' ? candidate.note.trim() : '';
    const type = candidate.type === 'home_remedy' ? 'home_remedy' : candidate.type === 'otc' ? 'otc' : null;

    if (!title || !note || !type) {
      return null;
    }

    const combinedText = `${title} ${note}`.toLowerCase();

    if (DOSAGE_PATTERN.test(combinedText) || PRESCRIPTIVE_PATTERN.test(combinedText)) {
      return null;
    }

    if (patientTerms.some((term) => combinedText.includes(term))) {
      return null;
    }

    return {
      title,
      type,
      note,
    };
  }

  private sanitizeReasoningSummary(value: unknown): string {
    const summary = typeof value === 'string' ? value.trim() : '';

    if (!summary || DOSAGE_PATTERN.test(summary) || PRESCRIPTIVE_PATTERN.test(summary)) {
      return 'Suggestions were limited to general symptom relief and safety checks.';
    }

    return summary.slice(0, 280);
  }

  private createFallback(reasoningSummary: string, redFlags: string[] = []): DrugInfoToolOutput {
    return {
      suggestions: [],
      redFlags,
      reasoningSummary,
    };
  }
}
