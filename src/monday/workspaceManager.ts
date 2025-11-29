import { MondayClient } from './client.js';
import type { 
  WorkspaceConfig, 
  BoardConfig, 
  Task, 
  TaskAsset, 
  MondayUser, 
  MondayItem,
  MondayColumnValue,
  ColumnValue,
  DateRange 
} from './types.js';

export class MondayWorkspaceManager {
  private workspaces: Map<string, WorkspaceConfig> = new Map();
  private clients: Map<string, MondayClient> = new Map();
  private userCache: Map<string, MondayUser> = new Map();
  private initialized = false;

  async initialize(configs: WorkspaceConfig[]): Promise<void> {
    console.log(`🔧 [MondayWorkspaceManager] Initializing with ${configs.length} workspace(s)`);
    
    for (const config of configs) {
      this.workspaces.set(config.id, config);
      this.clients.set(config.id, new MondayClient(config.apiToken));
      console.log(`📁 [MondayWorkspaceManager] Added workspace: ${config.name} (${config.id}) with ${config.boards.length} board(s)`);
    }

    await this.loadUsers();
    this.initialized = true;
    console.log(`✅ [MondayWorkspaceManager] Initialization complete. User cache: ${this.userCache.size} users`);
  }

  private async loadUsers(): Promise<void> {
    console.log(`👥 [MondayWorkspaceManager] Loading users from all workspaces...`);
    
    for (const [workspaceId, client] of this.clients) {
      try {
        const users = await client.getUsers();
        for (const user of users) {
          this.userCache.set(user.id, user);
        }
        console.log(`👥 [MondayWorkspaceManager] Loaded ${users.length} users from workspace ${workspaceId}`);
      } catch (error: any) {
        console.error(`❌ [MondayWorkspaceManager] Failed to load users from workspace ${workspaceId}: ${error.message}`);
      }
    }
  }

  async getTasksDueInRange(startDate: Date, endDate: Date): Promise<Task[]> {
    if (!this.initialized) {
      throw new Error('MondayWorkspaceManager not initialized. Call initialize() first.');
    }

    console.log(`📅 [MondayWorkspaceManager] Getting tasks due between ${startDate.toISOString()} and ${endDate.toISOString()}`);
    
    const allTasks: Task[] = [];

    for (const [workspaceId, workspace] of this.workspaces) {
      const client = this.clients.get(workspaceId)!;
      
      for (const board of workspace.boards) {
        try {
          const tasks = await this.getTasksFromBoard(
            client,
            board,
            workspace,
            startDate,
            endDate
          );
          allTasks.push(...tasks);
          console.log(`📋 [MondayWorkspaceManager] Found ${tasks.length} tasks in board ${board.name}`);
        } catch (error: any) {
          console.error(`❌ [MondayWorkspaceManager] Error fetching from board ${board.name}: ${error.message}`);
        }
      }
    }

    allTasks.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.getTime() - b.dueDate.getTime();
    });

    console.log(`✅ [MondayWorkspaceManager] Total tasks found: ${allTasks.length}`);
    return allTasks;
  }

  private async getTasksFromBoard(
    client: MondayClient,
    board: BoardConfig,
    workspace: WorkspaceConfig,
    startDate: Date,
    endDate: Date
  ): Promise<Task[]> {
    const tasks: Task[] = [];
    
    try {
      const { board: boardData, items } = await client.getAllItemsFromBoard(board.id);
      
      for (const item of items) {
        const task = this.parseItemToTask(item, board, workspace, boardData);
        
        if (task.dueDate) {
          const dueTime = task.dueDate.getTime();
          if (dueTime >= startDate.getTime() && dueTime <= endDate.getTime()) {
            tasks.push(task);
          }
        }
      }
    } catch (error: any) {
      console.error(`❌ [MondayWorkspaceManager] Failed to get items from board ${board.id}: ${error.message}`);
    }

    return tasks;
  }

  private parseItemToTask(
    item: MondayItem,
    boardConfig: BoardConfig,
    workspace: WorkspaceConfig,
    boardData: any
  ): Task {
    const columnValues: Record<string, ColumnValue> = {};
    let dueDate: Date | null = null;
    let assigneeId: string | null = null;
    let assigneeName: string | null = null;
    let status = '';
    let statusColor = '';
    const assets: TaskAsset[] = [];

    for (const col of item.column_values || []) {
      const columnTitle = col.column?.title || col.id;
      
      columnValues[col.id] = {
        id: col.id,
        title: columnTitle,
        text: col.text || '',
        value: col.value ? this.safeJsonParse(col.value) : null,
        type: col.type,
      };

      if (col.id === boardConfig.dateColumnId && col.value) {
        dueDate = this.parseDateColumn(col.value);
      }

      if (col.id === boardConfig.assigneeColumnId && col.value) {
        const parsed = this.parseAssigneeColumn(col.value);
        assigneeId = parsed.id;
        assigneeName = parsed.name;
      }

      if (col.type === 'status' || col.type === 'color') {
        const parsed = this.safeJsonParse(col.value);
        if (parsed) {
          status = col.text || parsed.label || '';
          statusColor = parsed.color || '';
        }
      }
    }

    if (item.assets) {
      for (const asset of item.assets) {
        assets.push({
          id: asset.id,
          name: asset.name,
          url: asset.url,
          fileExtension: asset.file_extension,
        });
      }
    }

    for (const col of item.column_values || []) {
      if (col.type === 'file' && col.value) {
        const parsed = this.safeJsonParse(col.value);
        if (parsed?.files) {
          for (const file of parsed.files) {
            assets.push({
              id: file.assetId?.toString() || file.fileId || '',
              name: file.name || 'Unknown file',
              url: file.publicUrl || file.url || '',
              fileExtension: file.fileExtension || this.getExtensionFromName(file.name),
            });
          }
        }
      }
    }

    const taskUrl = `https://${workspace.subdomain}.monday.com/boards/${boardConfig.id}/pulses/${item.id}`;

    return {
      id: item.id,
      name: item.name,
      boardId: boardConfig.id,
      boardName: boardConfig.name,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      groupName: item.group?.title || '',
      dueDate,
      assigneeId,
      assigneeName,
      status,
      statusColor,
      assets,
      columnValues,
      url: taskUrl,
      createdAt: new Date(item.created_at),
      updatedAt: new Date(item.updated_at),
    };
  }

  private parseDateColumn(value: string): Date | null {
    try {
      const parsed = JSON.parse(value);
      if (parsed.date) {
        const dateStr = parsed.date;
        const timeStr = parsed.time || '00:00:00';
        return new Date(`${dateStr}T${timeStr}`);
      }
    } catch {
    }
    return null;
  }

  private parseAssigneeColumn(value: string): { id: string | null; name: string | null } {
    try {
      const parsed = JSON.parse(value);
      if (parsed.personsAndTeams && parsed.personsAndTeams.length > 0) {
        const person = parsed.personsAndTeams[0];
        const userId = person.id?.toString();
        const user = userId ? this.userCache.get(userId) : null;
        return {
          id: userId || null,
          name: user?.name || null,
        };
      }
    } catch {
    }
    return { id: null, name: null };
  }

  private safeJsonParse(value: string): any {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private getExtensionFromName(name: string): string {
    if (!name) return '';
    const parts = name.split('.');
    return parts.length > 1 ? parts[parts.length - 1] : '';
  }

  async getTaskById(taskId: string): Promise<Task | null> {
    if (!this.initialized) {
      throw new Error('MondayWorkspaceManager not initialized. Call initialize() first.');
    }

    console.log(`🔍 [MondayWorkspaceManager] Searching for task ${taskId} across all workspaces`);

    for (const [workspaceId, workspace] of this.workspaces) {
      const client = this.clients.get(workspaceId)!;
      
      for (const board of workspace.boards) {
        try {
          const { items } = await client.getAllItemsFromBoard(board.id);
          const item = items.find(i => i.id === taskId);
          
          if (item) {
            console.log(`✅ [MondayWorkspaceManager] Found task ${taskId} in board ${board.name}`);
            return this.parseItemToTask(item, board, workspace, { id: board.id, name: board.name });
          }
        } catch (error: any) {
          console.error(`❌ [MondayWorkspaceManager] Error searching board ${board.id}: ${error.message}`);
        }
      }
    }

    console.log(`⚠️ [MondayWorkspaceManager] Task ${taskId} not found in any workspace`);
    return null;
  }

  getWorkspaceConfigs(): WorkspaceConfig[] {
    return Array.from(this.workspaces.values());
  }

  getUserById(userId: string): MondayUser | undefined {
    return this.userCache.get(userId);
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

export function loadWorkspaceConfigsFromEnv(): WorkspaceConfig[] {
  const configs: WorkspaceConfig[] = [];
  
  const mondayApiKey = process.env.MONDAY_API_KEY;
  const mondaySubdomain = process.env.MONDAY_SUBDOMAIN || 'stirlingmarketing';
  
  if (mondayApiKey) {
    const boardConfigsJson = process.env.MONDAY_BOARD_CONFIGS;
    
    let boards: BoardConfig[] = [];
    
    if (boardConfigsJson) {
      try {
        boards = JSON.parse(boardConfigsJson);
      } catch (e) {
        console.warn('⚠️ [MondayWorkspaceManager] Failed to parse MONDAY_BOARD_CONFIGS, using empty board list');
      }
    }
    
    configs.push({
      id: 'default',
      name: 'Stirling Marketing',
      apiToken: mondayApiKey,
      subdomain: mondaySubdomain,
      boards,
    });
  }

  let workspaceIndex = 1;
  while (process.env[`MONDAY_WORKSPACE_${workspaceIndex}_API_KEY`]) {
    const apiKey = process.env[`MONDAY_WORKSPACE_${workspaceIndex}_API_KEY`]!;
    const name = process.env[`MONDAY_WORKSPACE_${workspaceIndex}_NAME`] || `Workspace ${workspaceIndex}`;
    const subdomain = process.env[`MONDAY_WORKSPACE_${workspaceIndex}_SUBDOMAIN`] || 'monday';
    const id = process.env[`MONDAY_WORKSPACE_${workspaceIndex}_ID`] || `workspace_${workspaceIndex}`;
    const boardConfigsJson = process.env[`MONDAY_WORKSPACE_${workspaceIndex}_BOARDS`];
    
    let boards: BoardConfig[] = [];
    if (boardConfigsJson) {
      try {
        boards = JSON.parse(boardConfigsJson);
      } catch (e) {
        console.warn(`⚠️ [MondayWorkspaceManager] Failed to parse MONDAY_WORKSPACE_${workspaceIndex}_BOARDS`);
      }
    }
    
    configs.push({
      id,
      name,
      apiToken: apiKey,
      subdomain,
      boards,
    });
    
    workspaceIndex++;
  }

  return configs;
}

let globalWorkspaceManager: MondayWorkspaceManager | null = null;

export async function getWorkspaceManager(): Promise<MondayWorkspaceManager> {
  if (!globalWorkspaceManager) {
    globalWorkspaceManager = new MondayWorkspaceManager();
    const configs = loadWorkspaceConfigsFromEnv();
    if (configs.length > 0) {
      await globalWorkspaceManager.initialize(configs);
    } else {
      console.warn('⚠️ [MondayWorkspaceManager] No workspace configurations found in environment');
    }
  }
  return globalWorkspaceManager;
}
