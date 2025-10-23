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
          const columnTitleMap = new Map(
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
        const columnMap = new Map(
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
