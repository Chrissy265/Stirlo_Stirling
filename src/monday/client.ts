import type { MondayApiResponse, MondayUser, MondayBoard, ItemsPageResponse } from './types.js';
import { buildDateFilterQuery, GET_ITEMS_NO_FILTER, GET_USERS, GET_BOARDS_WITH_COLUMNS } from './queries.js';

export interface DateFilterOptions {
  columnId: string;
  startDate: string;
  endDate: string;
}

export class MondayClient {
  private apiToken: string;
  private baseUrl = 'https://api.monday.com/v2';
  private apiVersion = '2024-10';

  constructor(apiToken: string) {
    this.apiToken = apiToken;
  }

  async query<T = any>(graphqlQuery: string, variables?: Record<string, any>): Promise<T> {
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

    const result: MondayApiResponse = await response.json();

    if (result.errors && result.errors.length > 0) {
      throw new Error(`Monday.com API error: ${result.errors.map(e => e.message).join(', ')}`);
    }

    return result.data as T;
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
