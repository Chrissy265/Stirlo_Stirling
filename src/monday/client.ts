import type { MondayApiResponse, MondayUser, MondayBoard, ItemsPageResponse } from './types.js';
import { GET_ITEMS_FOR_DATE_FILTER, GET_USERS, GET_BOARDS_WITH_COLUMNS } from './queries.js';

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

  async getItemsPage(boardId: string, limit: number = 100, cursor?: string): Promise<{ board: MondayBoard; itemsPage: ItemsPageResponse }> {
    const data = await this.query<{ boards: MondayBoard[] }>(GET_ITEMS_FOR_DATE_FILTER, {
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
}
