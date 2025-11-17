import { dailyTaskMonitoringWorkflow } from './src/mastra/workflows/dailyTaskMonitoringWorkflow';

console.log('Workflow structure:');
console.log('ID:', (dailyTaskMonitoringWorkflow as any).id);
console.log('Keys:', Object.keys(dailyTaskMonitoringWorkflow));
console.log('\nWorkflow type:', typeof dailyTaskMonitoringWorkflow);
console.log('Has createRunAsync?', typeof (dailyTaskMonitoringWorkflow as any).createRunAsync);
console.log('Has steps?', 'steps' in (dailyTaskMonitoringWorkflow as any));
