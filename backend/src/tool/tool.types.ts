export interface ToolDefinition<TInput, TOutput> {
  name: string;
  description: string;
  inputType: string;
  outputType: string;
  inputSchema: Record<string, unknown>;
  execute(input: TInput): Promise<TOutput>;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  inputType: string;
  outputType: string;
  inputSchema: Record<string, unknown>;
}

export interface PatientContextToolInput {
  userId: string;
}

export interface PatientContextToolOutput {
  userId: string;
  allergies: string[];
  medicalConditions: string[];
  medicalHistory: string[];
}

export interface DrugInfoSuggestion {
  title: string;
  type: 'otc' | 'home_remedy';
  note: string;
}

export interface DrugInfoToolInput {
  userId: string;
  symptoms: string;
}

export interface DrugInfoToolOutput {
  suggestions: DrugInfoSuggestion[];
  redFlags: string[];
  reasoningSummary: string;
}

export interface BookAppointmentToolInput {
  specialty?: string;
  reason?: string;
}

export interface BookAppointmentContact {
  doctorName: string;
  specialty: string;
  phone: string;
  availabilityNote?: string;
}

export interface BookAppointmentToolOutput {
  status: 'human_follow_up_required';
  contacts: BookAppointmentContact[];
}
