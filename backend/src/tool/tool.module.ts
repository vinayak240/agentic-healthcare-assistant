import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { DalModule } from '../dal/dal.module';
import { ToolRegistry } from './tool.registry';
import { ToolService } from './tool.service';
import { BookAppointmentTool } from './tools/book-appointment.tool';
import { DrugInfoTool } from './tools/drug-info.tool';
import { PatientContextTool } from './tools/patient-context.tool';

@Module({
  // Tools depend on shared SDK clients and DAL providers, but the module only exports the
  // registry/service surface so the rest of the app stays decoupled from concrete tools.
  imports: [ClientsModule, DalModule],
  providers: [
    ToolService,
    ToolRegistry,
    PatientContextTool,
    DrugInfoTool,
    BookAppointmentTool,
  ],
  exports: [ToolService, ToolRegistry],
})
export class ToolModule {}
