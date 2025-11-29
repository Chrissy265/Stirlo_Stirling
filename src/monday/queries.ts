export function buildDateFilterQuery(boardId: string, columnId: string, startDate: string, endDate: string, limit: number = 100, cursor?: string): string {
  const cursorParam = cursor ? `cursor: "${cursor}",` : '';
  return `
    query {
      boards(ids: ["${boardId}"]) {
        id
        name
        workspace {
          id
          name
        }
        items_page(
          limit: ${limit},
          ${cursorParam}
          query_params: {
            rules: [
              {
                column_id: "${columnId}",
                compare_value: ["${startDate}", "${endDate}"],
                operator: between
              }
            ]
          }
        ) {
          cursor
          items {
            id
            name
            state
            created_at
            updated_at
            group {
              id
              title
            }
            column_values {
              id
              text
              value
              type
              column {
                id
                title
              }
            }
            assets {
              id
              name
              url
              file_extension
            }
          }
        }
      }
    }
  `;
}

export const GET_ITEMS_NO_FILTER = `
  query GetItemsNoFilter($boardId: ID!, $limit: Int!, $cursor: String) {
    boards(ids: [$boardId]) {
      id
      name
      workspace {
        id
        name
      }
      items_page(limit: $limit, cursor: $cursor) {
        cursor
        items {
          id
          name
          state
          created_at
          updated_at
          group {
            id
            title
          }
          column_values {
            id
            text
            value
            type
            column {
              id
              title
            }
          }
          assets {
            id
            name
            url
            file_extension
          }
        }
      }
    }
  }
`;

export const GET_USERS = `
  query GetUsers {
    users {
      id
      name
      email
    }
  }
`;

export const GET_BOARDS_WITH_COLUMNS = `
  query GetBoardsWithColumns($boardIds: [ID!]) {
    boards(ids: $boardIds) {
      id
      name
      workspace {
        id
        name
      }
      columns {
        id
        title
        type
      }
    }
  }
`;

export const GET_ALL_WORKSPACES = `
  query GetAllWorkspaces {
    workspaces {
      id
      name
    }
  }
`;

export const GET_BOARDS_IN_WORKSPACE = `
  query GetBoardsInWorkspace($workspaceId: ID!) {
    boards(workspace_ids: [$workspaceId], limit: 100) {
      id
      name
      workspace {
        id
        name
      }
      columns {
        id
        title
        type
      }
    }
  }
`;
