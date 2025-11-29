import { MondayWorkspaceManager, loadWorkspaceConfigsFromEnv } from '../monday/workspaceManager.js';
import { AlertGenerator, alertGenerator } from './alertGenerator.js';
import { DocumentExtractor, documentExtractor } from './documentExtractor.js';
import { TaskMonitor } from './taskMonitor.js';
import { UserMappingSync } from './userMappingSync.js';
import { AlertRepository, alertRepository } from '../database/repositories/alertRepository.js';
import { UserMappingRepository, userMappingRepository } from '../database/repositories/userMappingRepository.js';
import { QueryLogRepository, queryLogRepository } from '../database/repositories/queryLogRepository.js';

export interface MonitoringServices {
  taskMonitor: TaskMonitor;
  mondayManager: MondayWorkspaceManager;
  alertGenerator: AlertGenerator;
  documentExtractor: DocumentExtractor;
  userMappingSync: UserMappingSync;
  alertRepo: AlertRepository;
  userMappingRepo: UserMappingRepository;
  queryLogRepo: QueryLogRepository;
}

let servicesInstance: MonitoringServices | null = null;

export async function initializeMonitoringServices(): Promise<MonitoringServices> {
  if (servicesInstance) {
    console.log(`♻️ [Services] Returning existing services instance`);
    return servicesInstance;
  }

  console.log(`🚀 [Services] Initializing monitoring services...`);

  const workspaceConfigs = loadWorkspaceConfigsFromEnv();
  console.log(`📁 [Services] Loaded ${workspaceConfigs.length} workspace config(s)`);

  const mondayManager = new MondayWorkspaceManager();
  
  if (workspaceConfigs.length > 0) {
    await mondayManager.initialize(workspaceConfigs);
    console.log(`✅ [Services] Monday.com workspace manager initialized`);
  } else {
    console.warn(`⚠️ [Services] No Monday.com workspace configs found, tasks will not be available`);
  }

  const alertGeneratorInstance = alertGenerator;
  const documentExtractorInstance = documentExtractor;
  const alertRepoInstance = alertRepository;
  const userMappingRepoInstance = userMappingRepository;
  const queryLogRepoInstance = queryLogRepository;

  const taskMonitor = new TaskMonitor(
    mondayManager,
    alertGeneratorInstance,
    documentExtractorInstance,
    alertRepoInstance,
    userMappingRepoInstance,
    queryLogRepoInstance
  );
  console.log(`✅ [Services] Task monitor initialized`);

  const userMappingSync = new UserMappingSync(mondayManager, userMappingRepoInstance);
  console.log(`✅ [Services] User mapping sync initialized`);

  servicesInstance = {
    taskMonitor,
    mondayManager,
    alertGenerator: alertGeneratorInstance,
    documentExtractor: documentExtractorInstance,
    userMappingSync,
    alertRepo: alertRepoInstance,
    userMappingRepo: userMappingRepoInstance,
    queryLogRepo: queryLogRepoInstance,
  };

  console.log(`🎉 [Services] All monitoring services initialized successfully`);
  return servicesInstance;
}

export function getMonitoringServices(): MonitoringServices | null {
  return servicesInstance;
}

export async function syncUserMappings(): Promise<{ matched: number; total: number }> {
  const services = await initializeMonitoringServices();
  return services.userMappingSync.syncUsers();
}

export async function processDailyAlerts(): Promise<{ alerts: number; message: string }> {
  console.log(`📅 [Services] Running daily alert processing...`);
  const services = await initializeMonitoringServices();
  
  const alerts = await services.taskMonitor.processDailyTasks();
  const message = services.taskMonitor.formatDailySummaryForSlack(alerts);
  
  console.log(`✅ [Services] Daily processing complete: ${alerts.length} alerts generated`);
  return { alerts: alerts.length, message };
}

export async function processWeeklyAlerts(): Promise<{ alerts: number; message: string }> {
  console.log(`📅 [Services] Running weekly alert processing...`);
  const services = await initializeMonitoringServices();
  
  const alerts = await services.taskMonitor.processWeeklyTasks();
  const message = services.taskMonitor.formatWeeklySummaryForSlack(alerts);
  
  console.log(`✅ [Services] Weekly processing complete: ${alerts.length} alerts generated`);
  return { alerts: alerts.length, message };
}

export async function getTasksOnDemand(
  type: 'today' | 'week' | 'overdue',
  userId?: string
): Promise<{ alerts: number; message: string }> {
  console.log(`🔍 [Services] On-demand task request: type=${type}, userId=${userId || 'all'}`);
  const services = await initializeMonitoringServices();
  
  const alerts = await services.taskMonitor.getTasksOnDemand(type, userId);
  const message = services.taskMonitor.formatAlertsForSlack(alerts);
  
  console.log(`✅ [Services] On-demand request complete: ${alerts.length} tasks found`);
  return { alerts: alerts.length, message };
}

export { AlertGenerator } from './alertGenerator.js';
export { DocumentExtractor } from './documentExtractor.js';
export { TaskMonitor } from './taskMonitor.js';
export { UserMappingSync } from './userMappingSync.js';
