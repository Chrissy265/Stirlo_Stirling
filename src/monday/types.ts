export interface WorkspaceConfig {
  id: string;
  name: string;
  apiToken: string;
  subdomain: string;
  boards: BoardConfig[];
}

export interface BoardConfig {
  id: string;
  name: string;
  dateColumnId: string;
  assigneeColumnId: string;
}

export interface Task {
  id: string;
  name: string;
  boardId: string;
  boardName: string;
  workspaceId: string;
  workspaceName: string;
  groupName: string;
  dueDate: Date | null;
  assigneeId: string | null;
  assigneeName: string | null;
  status: string;
  statusColor: string;
  assets: TaskAsset[];
  columnValues: Record<string, ColumnValue>;
  url: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskAsset {
  id: string;
  name: string;
  url: string;
  fileExtension: string;
}

export interface ColumnValue {
  id: string;
  title: string;
  text: string;
  value: any;
  type: string;
}

export interface MondayUser {
  id: string;
  name: string;
  email: string;
}

export interface MondayApiResponse {
  data?: any;
  errors?: Array<{ message: string }>;
  account_id?: number;
}

export interface ItemsPageResponse {
  cursor: string | null;
  items: MondayItem[];
}

export interface MondayItem {
  id: string;
  name: string;
  state: string;
  created_at: string;
  updated_at: string;
  group?: {
    id: string;
    title: string;
  };
  column_values: MondayColumnValue[];
  assets?: MondayAsset[];
}

export interface MondayColumnValue {
  id: string;
  text: string;
  value: string;
  type: string;
  column?: {
    id: string;
    title: string;
  };
}

export interface MondayAsset {
  id: string;
  name: string;
  url: string;
  file_extension: string;
}

export interface MondayBoard {
  id: string;
  name: string;
  workspace?: {
    id: string;
    name: string;
  };
  columns?: MondayColumn[];
  items_page?: ItemsPageResponse;
}

export interface MondayColumn {
  id: string;
  title: string;
  type: string;
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
}
