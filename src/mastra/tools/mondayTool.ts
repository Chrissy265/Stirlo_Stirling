import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * monday.com Tool
 * 
 * Queries tasks, boards, and workspace information from monday.com
 * Monitors deadlines and retrieves task status
 */

interface MondayApiResponse {
  data?: any;
  errors?: Array<{ message: string }>;
}

interface ColumnInfo {
  title: string;
  type: string;
}

async function queryMonday(query: string): Promise<any> {
  const apiKey = process.env.MONDAY_API_KEY;
  
  if (!apiKey) {
    throw new Error('MONDAY_API_KEY environment variable is not set');
  }

  const response = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey,
      'API-Version': '2024-10',
    },
    body: JSON.stringify({ query }),
  });

  const result: MondayApiResponse = await response.json();

  if (result.errors && result.errors.length > 0) {
    throw new Error(`monday.com API error: ${result.errors.map(e => e.message).join(', ')}`);
  }

  return result.data;
}

export const mondaySearchTool = createTool({
  id: "monday-search-tasks",
  description: `Search and retrieve tasks, items, and information from monday.com workspace. Use this when users ask about tasks, project status, deadlines, assignments, or board information.`,
  
  inputSchema: z.object({
    searchQuery: z.string().describe("What to search for (task name, board name, person name, or keywords)"),
    includeDeadlines: z.boolean().optional().default(false).describe("Whether to focus on deadline/due date information"),
  }),
  
  outputSchema: z.object({
    boards: z.array(z.object({
      id: z.string(),
      name: z.string(),
      items: z.array(z.object({
        id: z.string(),
        name: z.string(),
        state: z.string().optional(),
        columnValues: z.array(z.object({
          title: z.string(),
          text: z.string().optional(),
          value: z.string().optional(),
        })).optional(),
      })),
    })),
    totalItems: z.number(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('📋 [monday.com] Starting search', { 
      searchQuery: context.searchQuery,
      includeDeadlines: context.includeDeadlines 
    });
    
    try {
      // Query to get all boards, their columns (for titles), and items
      const query = `
        query {
          boards (limit: 50) {
            id
            name
            columns {
              id
              title
              type
            }
            items_page (limit: 100) {
              items {
                id
                name
                state
                column_values {
                  id
                  text
                  value
                  type
                }
              }
            }
          }
        }
      `;
      
      logger?.info('📋 [monday.com] Fetching boards and items from API');
      
      const data = await queryMonday(query);
      
      if (!data || !data.boards) {
        logger?.warn('⚠️ [monday.com] No boards found');
        return { boards: [], totalItems: 0 };
      }
      
      logger?.info('📋 [monday.com] Processing results', { boardsCount: data.boards.length });
      
      // Filter and process results based on search query
      const searchLower = context.searchQuery.toLowerCase();
      let totalItems = 0;
      
      const filteredBoards = data.boards
        .map((board: any) => {
          const items = board.items_page?.items || [];
          const columns = board.columns || [];
          
          // Create a map of column IDs to titles for easy lookup
          const columnTitleMap = new Map<string, ColumnInfo>(
            columns.map((col: any) => [col.id, { title: col.title, type: col.type }])
          );
          
          // Filter items that match the search query
          const matchingItems = items.filter((item: any) => {
            const nameMatch = item.name?.toLowerCase().includes(searchLower);
            const columnMatch = item.column_values?.some((col: any) => {
              const colInfo = columnTitleMap.get(col.id);
              return col.text?.toLowerCase().includes(searchLower) ||
                     colInfo?.title?.toLowerCase().includes(searchLower);
            });
            
            // If looking for deadlines, prioritize items with date columns
            if (context.includeDeadlines) {
              const hasDeadline = item.column_values?.some((col: any) => {
                const colInfo = columnTitleMap.get(col.id);
                return col.type === 'date' || 
                       colInfo?.title?.toLowerCase().includes('deadline') ||
                       colInfo?.title?.toLowerCase().includes('due');
              });
              return (nameMatch || columnMatch) && hasDeadline;
            }
            
            return nameMatch || columnMatch;
          }).map((item: any) => ({
            id: item.id,
            name: item.name,
            state: item.state,
            columnValues: item.column_values?.map((col: any) => {
              const colInfo = columnTitleMap.get(col.id);
              return {
                title: colInfo?.title || col.id,
                text: col.text || '',
                value: col.value || '',
              };
            }) || [],
          }));
          
          totalItems += matchingItems.length;
          
          return {
            id: board.id,
            name: board.name,
            items: matchingItems,
          };
        })
        .filter((board: any) => board.items.length > 0);
      
      logger?.info('✅ [monday.com] Search completed successfully', { 
        boardsWithMatches: filteredBoards.length,
        totalMatchingItems: totalItems 
      });
      
      return {
        boards: filteredBoards,
        totalItems,
      };
    } catch (error: any) {
      logger?.error('❌ [monday.com] Error occurred', { 
        error: error.message,
        stack: error.stack 
      });
      throw new Error(`monday.com search failed: ${error.message}`);
    }
  },
});

export const mondayGetUpcomingDeadlinesTool = createTool({
  id: "monday-get-upcoming-deadlines",
  description: `Get tasks with upcoming deadlines from monday.com. Use this for proactive deadline monitoring and reminder notifications.`,
  
  inputSchema: z.object({
    daysAhead: z.number().optional().default(7).describe("Number of days to look ahead for deadlines (default: 7)"),
  }),
  
  outputSchema: z.object({
    upcomingTasks: z.array(z.object({
      boardName: z.string(),
      itemName: z.string(),
      deadline: z.string(),
      daysUntilDeadline: z.number(),
      assignees: z.array(z.string()).optional(),
      status: z.string().optional(),
    })),
    totalUpcoming: z.number(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('📅 [monday.com Deadlines] Checking upcoming deadlines', { daysAhead: context.daysAhead });
    
    try {
      const query = `
        query {
          boards (limit: 50) {
            id
            name
            columns {
              id
              title
              type
            }
            items_page (limit: 100) {
              items {
                id
                name
                state
                column_values {
                  id
                  text
                  value
                  type
                }
              }
            }
          }
        }
      `;
      
      logger?.info('📅 [monday.com Deadlines] Fetching data from API');
      
      const data = await queryMonday(query);
      
      if (!data || !data.boards) {
        logger?.warn('⚠️ [monday.com Deadlines] No boards found');
        return { upcomingTasks: [], totalUpcoming: 0 };
      }
      
      const now = new Date();
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + context.daysAhead);
      
      const upcomingTasks: any[] = [];
      
      // Process all boards and items
      data.boards.forEach((board: any) => {
        const items = board.items_page?.items || [];
        const columns = board.columns || [];
        
        // Create a map of column IDs to column info
        const columnMap = new Map<string, ColumnInfo>(
          columns.map((col: any) => [col.id, { title: col.title, type: col.type }])
        );
        
        items.forEach((item: any) => {
          // Look for date columns that might be deadlines
          const dateColumns = item.column_values?.filter((col: any) => {
            const colInfo = columnMap.get(col.id);
            return col.type === 'date' && col.value && col.value !== '{}' &&
                   (colInfo?.title?.toLowerCase().includes('deadline') ||
                    colInfo?.title?.toLowerCase().includes('due') ||
                    colInfo?.title?.toLowerCase().includes('date'));
          });
          
          dateColumns?.forEach((dateCol: any) => {
            try {
              const dateValue = JSON.parse(dateCol.value);
              if (dateValue.date) {
                const deadline = new Date(dateValue.date);
                
                // Check if deadline is within the specified range
                if (deadline >= now && deadline <= futureDate) {
                  const daysUntil = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                  
                  // Get assignees if available
                  const peopleColumns = item.column_values?.filter((col: any) => col.type === 'people');
                  const assignees = peopleColumns?.map((col: any) => col.text).filter(Boolean) || [];
                  
                  upcomingTasks.push({
                    boardName: board.name,
                    itemName: item.name,
                    deadline: deadline.toISOString(),
                    daysUntilDeadline: daysUntil,
                    assignees,
                    status: item.state || 'Unknown',
                  });
                }
              }
            } catch (e) {
              // Skip invalid date values
            }
          });
        });
      });
      
      // Sort by deadline (soonest first)
      upcomingTasks.sort((a, b) => a.daysUntilDeadline - b.daysUntilDeadline);
      
      logger?.info('✅ [monday.com Deadlines] Found upcoming deadlines', { 
        totalUpcoming: upcomingTasks.length 
      });
      
      return {
        upcomingTasks,
        totalUpcoming: upcomingTasks.length,
      };
    } catch (error: any) {
      logger?.error('❌ [monday.com Deadlines] Error occurred', { 
        error: error.message,
        stack: error.stack 
      });
      throw new Error(`monday.com deadline check failed: ${error.message}`);
    }
  },
});

export const mondaySearchWithDocsTool = createTool({
  id: "monday-search-with-docs",
  description: `Comprehensive search of monday.com that retrieves BOTH tasks AND documentation including attached files (PDFs, Word docs, images), doc column content, and update notes. Use this when users ask about documents, files, notes, or any written content in monday.com.`,
  
  inputSchema: z.object({
    searchQuery: z.string().describe("What to search for in tasks and documentation (keywords, topics, file names)"),
    includeFiles: z.boolean().optional().default(true).describe("Whether to extract attached file assets"),
    includeUpdates: z.boolean().optional().default(true).describe("Whether to extract notes and comments from updates"),
  }),
  
  outputSchema: z.object({
    items: z.array(z.object({
      boardName: z.string(),
      itemId: z.string(),
      itemName: z.string(),
      state: z.string().optional(),
      taskInfo: z.object({
        columnValues: z.array(z.object({
          title: z.string(),
          text: z.string().optional(),
          value: z.string().optional(),
        })),
      }),
      documentation: z.object({
        files: z.array(z.object({
          id: z.string(),
          name: z.string(),
          url: z.string(),
          extension: z.string().optional(),
        })),
        docColumns: z.array(z.object({
          columnTitle: z.string(),
          content: z.string(),
        })),
        updates: z.array(z.object({
          id: z.string(),
          text: z.string(),
          createdAt: z.string().optional(),
        })),
      }),
    })),
    totalItems: z.number(),
    totalFiles: z.number(),
    totalUpdates: z.number(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('📄 [monday.com Docs] Starting comprehensive search with documentation', { 
      searchQuery: context.searchQuery,
      includeFiles: context.includeFiles,
      includeUpdates: context.includeUpdates,
    });
    
    try {
      const query = `
        query {
          boards (limit: 15) {
            id
            name
            columns {
              id
              title
              type
            }
            items_page (limit: 30) {
              items {
                id
                name
                state
                column_values {
                  id
                  text
                  value
                  type
                }
                assets {
                  id
                  name
                  url
                  file_extension
                }
                ${context.includeUpdates ? `
                updates {
                  id
                  text_body
                  created_at
                }
                ` : ''}
              }
            }
          }
        }
      `;
      
      logger?.info('📄 [monday.com Docs] Fetching boards, items, files, and updates from API');
      
      const data = await queryMonday(query);
      
      if (!data || !data.boards) {
        logger?.warn('⚠️ [monday.com Docs] No boards found');
        return { items: [], totalItems: 0, totalFiles: 0, totalUpdates: 0 };
      }
      
      logger?.info('📄 [monday.com Docs] Processing results', { boardsCount: data.boards.length });
      
      const searchLower = context.searchQuery.toLowerCase();
      const allItems: any[] = [];
      let totalFiles = 0;
      let totalUpdates = 0;
      
      data.boards.forEach((board: any) => {
        const items = board.items_page?.items || [];
        const columns = board.columns || [];
        
        const columnTitleMap = new Map<string, ColumnInfo>(
          columns.map((col: any) => [col.id, { title: col.title, type: col.type }])
        );
        
        items.forEach((item: any) => {
          const assets = item.assets || [];
          const updates = item.updates || [];
          const columnValues = item.column_values || [];
          
          const nameMatch = item.name?.toLowerCase().includes(searchLower);
          
          const fileMatch = assets.some((asset: any) => 
            asset.name?.toLowerCase().includes(searchLower)
          );
          
          const updateMatch = updates.some((update: any) => 
            update.text_body?.toLowerCase().includes(searchLower)
          );
          
          const docColumnMatch = columnValues.some((col: any) => {
            const colInfo = columnTitleMap.get(col.id);
            return colInfo?.type === 'doc' && col.text?.toLowerCase().includes(searchLower);
          });
          
          const columnMatch = columnValues.some((col: any) => {
            const colInfo = columnTitleMap.get(col.id);
            return col.text?.toLowerCase().includes(searchLower) ||
                   colInfo?.title?.toLowerCase().includes(searchLower);
          });
          
          if (nameMatch || fileMatch || updateMatch || docColumnMatch || columnMatch) {
            const files = context.includeFiles ? assets.map((asset: any) => ({
              id: asset.id,
              name: asset.name || 'Unnamed file',
              url: asset.url,
              extension: asset.file_extension || '',
            })) : [];
            
            const docColumns = columnValues
              .filter((col: any) => {
                const colInfo = columnTitleMap.get(col.id);
                return colInfo?.type === 'doc' && col.text;
              })
              .map((col: any) => {
                const colInfo = columnTitleMap.get(col.id);
                return {
                  columnTitle: colInfo?.title || col.id,
                  content: col.text || '',
                };
              });
            
            const itemUpdates = context.includeUpdates ? updates.map((update: any) => ({
              id: update.id,
              text: update.text_body || '',
              createdAt: update.created_at || '',
            })) : [];
            
            totalFiles += files.length;
            totalUpdates += itemUpdates.length;
            
            allItems.push({
              boardName: board.name,
              itemId: item.id,
              itemName: item.name,
              state: item.state,
              taskInfo: {
                columnValues: columnValues.map((col: any) => {
                  const colInfo = columnTitleMap.get(col.id);
                  return {
                    title: colInfo?.title || col.id,
                    text: col.text || '',
                    value: col.value || '',
                  };
                }),
              },
              documentation: {
                files,
                docColumns,
                updates: itemUpdates,
              },
            });
          }
        });
      });
      
      logger?.info('✅ [monday.com Docs] Search completed successfully', { 
        totalItems: allItems.length,
        totalFiles,
        totalUpdates,
      });
      
      return {
        items: allItems,
        totalItems: allItems.length,
        totalFiles,
        totalUpdates,
      };
    } catch (error: any) {
      logger?.error('❌ [monday.com Docs] Error occurred', { 
        error: error.message,
        stack: error.stack 
      });
      throw new Error(`monday.com documentation search failed: ${error.message}`);
    }
  },
});
