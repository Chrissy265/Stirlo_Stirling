import type { MondayApiResponse, MondayUser, MondayBoard, ItemsPageResponse } from './types.js';
import { buildDateFilterQuery, GET_ITEMS_NO_FILTER, GET_USERS, GET_BOARDS_WITH_COLUMNS } from './queries.js';

export interface DateFilterOptions {
  columnId: string;
  startDate: string;
  endDate: string;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error: any): boolean {
  const message = error?.message?.toLowerCase() || '';
  const errorName = error?.name?.toLowerCase() || '';
  const errorCode = error?.code?.toLowerCase() || '';
  
  const retryablePatterns = [
    'timeout',
    'network',
    'econnreset',
    'econnrefused',
    'enotfound',
    'econnaborted',
    'epipe',
    'ehostunreach',
    'enetunreach',
    'socket',
    'rate limit',
    'too many requests',
    'fetch failed',
    'request timeout',
    'abort',
    'cancel',
    'terminated',
    'connection',
    '408',
    '429',
    '500',
    '502',
    '503',
    '504',
    '520',
    '521',
    '522',
    '523',
    '524',
  ];
  
  const combinedText = `${message} ${errorName} ${errorCode}`;
  
  return retryablePatterns.some(pattern => combinedText.includes(pattern));
}

export class MondayClient {
  private apiToken: string;
  private baseUrl = 'https://api.monday.com/v2';
  private apiVersion = '2024-10';
  private retryConfig: RetryConfig;

  constructor(apiToken: string, retryConfig?: Partial<RetryConfig>) {
    this.apiToken = apiToken;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | null = null;
    let delay = this.retryConfig.initialDelayMs;

    for (let attempt = 1; attempt <= this.retryConfig.maxRetries + 1; attempt++) {
      try {
        const result = await operation();
        if (attempt > 1) {
          console.log(`✅ [MondayClient] ${operationName} succeeded on attempt ${attempt}`);
        }
        return result;
      } catch (error: any) {
        lastError = error;
        
        const isLastAttempt = attempt > this.retryConfig.maxRetries;
        const shouldRetry = !isLastAttempt && isRetryableError(error);
        
        if (shouldRetry) {
          console.warn(`⚠️ [MondayClient] ${operationName} failed (attempt ${attempt}/${this.retryConfig.maxRetries + 1}): ${error.message}`);
          console.log(`🔄 [MondayClient] Retrying in ${delay}ms...`);
          await sleep(delay);
          delay = Math.min(delay * this.retryConfig.backoffMultiplier, this.retryConfig.maxDelayMs);
        } else if (isLastAttempt) {
          console.error(`❌ [MondayClient] ${operationName} failed after ${attempt} attempts: ${error.message}`);
        } else {
          console.error(`❌ [MondayClient] ${operationName} failed with non-retryable error: ${error.message}`);
          throw error;
        }
      }
    }

    throw lastError || new Error(`${operationName} failed after all retries`);
  }

  async query<T = any>(graphqlQuery: string, variables?: Record<string, any>): Promise<T> {
    return this.executeWithRetry(async () => {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.apiToken,
          'API-Version': this.apiVersion,
        },
        body: JSON.stringify({ 
          query: graphqlQuery,
          variables: variables || {},
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result: MondayApiResponse = await response.json();

      if (result.errors && result.errors.length > 0) {
        const errorMessage = result.errors.map(e => e.message).join(', ');
        if (errorMessage.toLowerCase().includes('rate') || errorMessage.toLowerCase().includes('limit')) {
          throw new Error(`Rate limit: ${errorMessage}`);
        }
        throw new Error(`Monday.com API error: ${errorMessage}`);
      }

      return result.data as T;
    }, 'query');
  }

  async getUsers(): Promise<MondayUser[]> {
    const data = await this.query<{ users: MondayUser[] }>(GET_USERS);
    return data.users || [];
  }

  async getBoardsWithColumns(boardIds: string[]): Promise<MondayBoard[]> {
    const data = await this.query<{ boards: MondayBoard[] }>(GET_BOARDS_WITH_COLUMNS, { boardIds });
    return data.boards || [];
  }

  async getItemsPageFiltered(
    boardId: string, 
    dateFilter: DateFilterOptions,
    limit: number = 100,
    cursor?: string
  ): Promise<{ board: MondayBoard; itemsPage: ItemsPageResponse }> {
    const query = buildDateFilterQuery(
      boardId, 
      dateFilter.columnId, 
      dateFilter.startDate, 
      dateFilter.endDate,
      limit,
      cursor
    );
    
    const data = await this.query<{ boards: MondayBoard[] }>(query);

    const board = data.boards?.[0];
    if (!board) {
      throw new Error(`Board ${boardId} not found`);
    }

    return {
      board,
      itemsPage: board.items_page || { cursor: null, items: [] },
    };
  }

  async getItemsPage(boardId: string, limit: number = 100, cursor?: string): Promise<{ board: MondayBoard; itemsPage: ItemsPageResponse }> {
    const data = await this.query<{ boards: MondayBoard[] }>(GET_ITEMS_NO_FILTER, {
      boardId,
      limit,
      cursor: cursor || null,
    });

    const board = data.boards?.[0];
    if (!board) {
      throw new Error(`Board ${boardId} not found`);
    }

    return {
      board,
      itemsPage: board.items_page || { cursor: null, items: [] },
    };
  }

  async getItemsInDateRange(
    boardId: string, 
    dateColumnId: string,
    startDate: Date, 
    endDate: Date
  ): Promise<{ board: MondayBoard; items: any[] }> {
    const allItems: any[] = [];
    let cursor: string | undefined = undefined;
    let boardInfo: MondayBoard | undefined;

    const dateFilter: DateFilterOptions = {
      columnId: dateColumnId,
      startDate: this.formatDateForApi(startDate),
      endDate: this.formatDateForApi(endDate),
    };

    do {
      const { board, itemsPage } = await this.getItemsPageFiltered(boardId, dateFilter, 100, cursor);
      boardInfo = board;
      allItems.push(...itemsPage.items);
      cursor = itemsPage.cursor || undefined;
    } while (cursor);

    return {
      board: boardInfo!,
      items: allItems,
    };
  }

  async getAllItemsFromBoard(boardId: string): Promise<{ board: MondayBoard; items: any[] }> {
    const allItems: any[] = [];
    let cursor: string | undefined = undefined;
    let boardInfo: MondayBoard | undefined;

    do {
      const { board, itemsPage } = await this.getItemsPage(boardId, 100, cursor);
      boardInfo = board;
      allItems.push(...itemsPage.items);
      cursor = itemsPage.cursor || undefined;
    } while (cursor);

    return {
      board: boardInfo!,
      items: allItems,
    };
  }

  private formatDateForApi(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  async getBoardById(boardId: string): Promise<MondayBoard | null> {
    try {
      const query = `
        query GetBoard($boardId: ID!) {
          boards(ids: [$boardId]) {
            id
            name
            columns {
              id
              title
              type
            }
          }
        }
      `;
      
      const data = await this.query<{ boards: MondayBoard[] }>(query, { boardId });
      return data.boards?.[0] || null;
    } catch (error: any) {
      console.error(`❌ [MondayClient] getBoardById error: ${error.message}`);
      return null;
    }
  }

  async changeColumnValue(
    boardId: string,
    itemId: string,
    columnId: string,
    value: string
  ): Promise<boolean> {
    try {
      const mutation = `
        mutation ChangeColumnValue($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
          change_column_value(
            board_id: $boardId
            item_id: $itemId
            column_id: $columnId
            value: $value
          ) {
            id
          }
        }
      `;

      await this.query(mutation, {
        boardId,
        itemId,
        columnId,
        value
      });

      console.log(`✅ [MondayClient] Updated column ${columnId} for item ${itemId}`);
      return true;
    } catch (error: any) {
      console.error(`❌ [MondayClient] changeColumnValue error: ${error.message}`);
      return false;
    }
  }
}
