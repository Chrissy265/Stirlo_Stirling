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

/**
 * Fetch folders from Monday.com workspaces
 * Used to find docs folders like "SM Playbook"
 */
async function fetchFolders(workspaceIds?: number[]): Promise<any> {
  let query = '';
  
  if (workspaceIds && workspaceIds.length > 0) {
    // Query specific workspaces
    query = `
      query {
        folders (workspace_ids: [${workspaceIds.join(', ')}]) {
          id
          name
          color
          parent {
            id
          }
          workspace {
            id
            name
          }
        }
      }
    `;
  } else {
    // Query all workspaces first, then get their folders
    const workspacesQuery = `
      query {
        workspaces {
          id
          name
        }
      }
    `;
    
    const workspacesData = await queryMonday(workspacesQuery);
    if (!workspacesData || !workspacesData.workspaces || workspacesData.workspaces.length === 0) {
      return { folders: [] };
    }
    
    const ids = workspacesData.workspaces.map((w: any) => w.id);
    query = `
      query {
        folders (workspace_ids: [${ids.join(', ')}]) {
          id
          name
          color
          parent {
            id
          }
          workspace {
            id
            name
          }
          children {
            id
            name
          }
        }
      }
    `;
  }
  
  return await queryMonday(query);
}

/**
 * Fetch documents (workdocs) from a specific folder
 * Note: Monday.com API doesn't support filtering by folder_ids directly,
 * so we query all docs and filter by doc_folder_id
 */
async function fetchDocsFromFolder(folderId: string, workspaceId?: string): Promise<any> {
  // Query docs from the workspace if provided, otherwise query all
  // Note: Monday.com API doesn't support folder_ids filter, so we query all docs and filter client-side
  
  // Only add workspace filter if we have a valid workspace ID
  const hasValidWorkspaceId = workspaceId && workspaceId !== 'undefined' && workspaceId !== 'null';
  const workspaceFilter = hasValidWorkspaceId ? `workspace_ids: [${workspaceId}], ` : '';
  
  const query = `
    query {
      docs(${workspaceFilter}limit: 100) {
        id
        name
        url
        created_at
        updated_at
        doc_kind
        doc_folder_id
        workspace_id
      }
    }
  `;
  
  const result = await queryMonday(query);
  
  // Filter docs to only include those in the specified folder
  if (result && result.docs && Array.isArray(result.docs)) {
    const filteredDocs = result.docs.filter((doc: any) => doc.doc_folder_id === folderId);
    return { docs: filteredDocs };
  }
  
  return { docs: [] };
}

/**
 * Extract meaningful keywords from a search query
 * Removes minimal set of common stop words
 * Preserves short words (acronyms like AI, HR, UX) that aren't stop words
 */
function extractKeywords(query: string): string[] {
  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but',
    'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'is', 'are', 'was', 'were', 'be', 'been',
    'have', 'has', 'had',
    'do', 'does', 'did',
    'can', 'could', 'will', 'would', 'should',
    'this', 'that', 'these', 'those',
    'i', 'you', 'he', 'she', 'it', 'we', 'they',
    'my', 'your', 'his', 'her', 'its', 'our', 'their'
  ]);
  
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.replace(/[^\w]/g, ''))
    .filter(word => word.length > 0 && !stopWords.has(word));
  
  if (words.length === 0) {
    return [query.toLowerCase()];
  }
  
  return words;
}

/**
 * Check if text contains any of the keywords
 */
function matchesKeywords(text: string | null | undefined, keywords: string[]): boolean {
  if (!text) return false;
  const textLower = text.toLowerCase();
  return keywords.some(keyword => textLower.includes(keyword));
}

/**
 * Check if text contains ALL keywords (for stricter multi-keyword matching)
 */
function matchesAllKeywords(text: string | null | undefined, keywords: string[]): boolean {
  if (!text) return false;
  const textLower = text.toLowerCase();
  return keywords.every(keyword => textLower.includes(keyword));
}

/**
 * Check if a keyword matches as a whole word (not substring)
 * e.g., "sm" matches "SM Playbook" but not "SMS"
 */
function matchesWholeWord(text: string, keyword: string): boolean {
  const textLower = text.toLowerCase();
  const keywordLower = keyword.toLowerCase();
  
  // Use word boundary regex to match whole words only
  const regex = new RegExp(`\\b${keywordLower}\\b`);
  return regex.test(textLower);
}

/**
 * Calculate relevance score based on keyword matches
 * Heavily prioritizes exact phrase matches in item names
 */
function calculateRelevance(item: any, keywords: string[], assets?: any[], updates?: any[], columnValues?: any[], columnTitleMap?: Map<string, ColumnInfo>, originalQuery?: string): number {
  let score = 0;
  const itemNameLower = item.name?.toLowerCase() || '';
  
  // EXACT PHRASE MATCH in item name gets massive boost (this is what users expect)
  if (originalQuery && itemNameLower.includes(originalQuery.toLowerCase())) {
    score += 100; // Exact phrase match is top priority
  }
  
  // Count how many keywords match as WHOLE WORDS in the item name
  const keywordsInName = keywords.filter(keyword => matchesWholeWord(item.name || '', keyword));
  
  // Multi-keyword matches in name get significant boost
  if (keywordsInName.length >= 2) {
    score += keywordsInName.length * 10; // Strong multi-keyword match
  } else if (keywordsInName.length === 1) {
    score += 3; // Single keyword match (weak)
  }
  
  // Check assets for keyword matches
  if (assets) {
    assets.forEach((asset: any) => {
      const assetNameLower = asset.name?.toLowerCase() || '';
      if (originalQuery && assetNameLower.includes(originalQuery.toLowerCase())) {
        score += 5; // Exact phrase in file name
      }
      keywords.forEach(keyword => {
        if (assetNameLower.includes(keyword)) score += 2;
      });
    });
  }
  
  // Check updates for keyword matches
  if (updates) {
    updates.forEach((update: any) => {
      const updateTextLower = update.text_body?.toLowerCase() || '';
      if (originalQuery && updateTextLower.includes(originalQuery.toLowerCase())) {
        score += 3; // Exact phrase in update
      }
      keywords.forEach(keyword => {
        if (updateTextLower.includes(keyword)) score += 1;
      });
    });
  }
  
  // Check column values for keyword matches
  if (columnValues) {
    columnValues.forEach((col: any) => {
      const colTextLower = col.text?.toLowerCase() || '';
      if (colTextLower) {
        keywords.forEach(keyword => {
          if (colTextLower.includes(keyword)) score += 1;
        });
      }
      
      if (columnTitleMap) {
        const colInfo = columnTitleMap.get(col.id);
        const colTitleLower = colInfo?.title?.toLowerCase() || '';
        if (colTitleLower) {
          keywords.forEach(keyword => {
            if (colTitleLower.includes(keyword)) score += 1;
          });
        }
      }
    });
  }
  
  return score;
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
      workspaceName: z.string().optional(),
      workspaceId: z.string().optional(),
      items: z.array(z.object({
        id: z.string(),
        name: z.string(),
        url: z.string().describe("Direct link to the task in Monday.com"),
        state: z.string().optional(),
        columnValues: z.array(z.object({
          title: z.string(),
          text: z.string().optional(),
          value: z.string().optional(),
        })).optional(),
      })),
    })),
    totalItems: z.number(),
    workspacesSearched: z.array(z.string()),
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
            workspace {
              id
              name
            }
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
        return { boards: [], totalItems: 0, workspacesSearched: [] };
      }
      
      logger?.info('📋 [monday.com] Processing results', { boardsCount: data.boards.length });
      
      const keywords = extractKeywords(context.searchQuery);
      logger?.info('📋 [monday.com] Extracted keywords', { 
        originalQuery: context.searchQuery,
        keywords 
      });
      
      let totalItems = 0;
      const workspacesFound = new Set<string>();
      
      const filteredBoards = data.boards
        .map((board: any) => {
          const workspace = board.workspace || {};
          if (workspace.name) {
            workspacesFound.add(workspace.name);
          }
          logger?.debug('📋 [monday.com] Processing board', { 
            boardName: board.name,
            workspaceName: workspace.name || 'Main Workspace',
            workspaceId: workspace.id || 'null'
          });
          
          const items = board.items_page?.items || [];
          const columns = board.columns || [];
          
          // Create a map of column IDs to titles for easy lookup
          const columnTitleMap = new Map<string, ColumnInfo>(
            columns.map((col: any) => [col.id, { title: col.title, type: col.type }])
          );
          
          const mondaySubdomain = process.env.MONDAY_SUBDOMAIN || 'stirlingmarketing';
          
          // Filter items that match the search query using keywords
          const matchingItems = items.filter((item: any) => {
            const nameMatch = matchesKeywords(item.name, keywords);
            const columnMatch = item.column_values?.some((col: any) => {
              const colInfo = columnTitleMap.get(col.id);
              return matchesKeywords(col.text, keywords) ||
                     matchesKeywords(colInfo?.title, keywords);
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
          }).map((item: any) => {
            const columnValues = item.column_values?.map((col: any) => {
              const colInfo = columnTitleMap.get(col.id);
              return {
                title: colInfo?.title || col.id,
                text: col.text || '',
                value: col.value || '',
              };
            }) || [];
            
            const relevanceScore = calculateRelevance(item, keywords, undefined, undefined, item.column_values, columnTitleMap, context.searchQuery);
            const taskUrl = `https://${mondaySubdomain}.monday.com/boards/${board.id}/pulses/${item.id}`;
            
            return {
              id: item.id,
              name: item.name,
              url: taskUrl,
              state: item.state,
              relevanceScore,
              columnValues,
            };
          })
          .filter((item: any) => item.relevanceScore >= 5) // Filter out weak matches (need keyword + context)
          .sort((a: any, b: any) => b.relevanceScore - a.relevanceScore);
          
          totalItems += matchingItems.length;
          
          return {
            id: board.id,
            name: board.name,
            workspaceName: workspace.name || 'Main Workspace',
            workspaceId: workspace.id?.toString() || null,
            items: matchingItems,
          };
        })
        .filter((board: any) => board.items.length > 0);
      
      const workspaceList = Array.from(workspacesFound);
      
      const topResults = filteredBoards
        .flatMap((board: any) => board.items.map((item: any) => ({ name: item.name, score: item.relevanceScore })))
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 3);
      
      logger?.info('✅ [monday.com] Search completed successfully', { 
        boardsWithMatches: filteredBoards.length,
        totalMatchingItems: totalItems,
        workspacesSearched: workspaceList,
        topResults,
      });
      
      return {
        boards: filteredBoards,
        totalItems,
        workspacesSearched: workspaceList.length > 0 ? workspaceList : ['Main Workspace'],
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
      boardId: z.string(),
      workspaceName: z.string().optional(),
      workspaceId: z.string().optional(),
      itemId: z.string(),
      itemName: z.string(),
      url: z.string().describe("Direct link to the task in Monday.com"),
      deadline: z.string(),
      daysUntilDeadline: z.number(),
      assignees: z.array(z.string()).optional(),
      status: z.string().optional(),
    })),
    totalUpcoming: z.number(),
    workspacesSearched: z.array(z.string()),
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
            workspace {
              id
              name
            }
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
        return { upcomingTasks: [], totalUpcoming: 0, workspacesSearched: [] };
      }
      
      const now = new Date();
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + context.daysAhead);
      
      const upcomingTasks: any[] = [];
      const workspacesFound = new Set<string>();
      
      const mondaySubdomain = process.env.MONDAY_SUBDOMAIN || 'stirlingmarketing';
      
      // Process all boards and items
      data.boards.forEach((board: any) => {
        const workspace = board.workspace || {};
        if (workspace.name) {
          workspacesFound.add(workspace.name);
        }
        logger?.debug('📅 [monday.com Deadlines] Processing board', { 
          boardName: board.name,
          workspaceName: workspace.name || 'Main Workspace',
          workspaceId: workspace.id || 'null'
        });
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
                  
                  const taskUrl = `https://${mondaySubdomain}.monday.com/boards/${board.id}/pulses/${item.id}`;
                  
                  upcomingTasks.push({
                    boardName: board.name,
                    boardId: board.id,
                    workspaceName: workspace.name || 'Main Workspace',
                    workspaceId: workspace.id?.toString() || null,
                    itemId: item.id,
                    itemName: item.name,
                    url: taskUrl,
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
      
      const workspaceList = Array.from(workspacesFound);
      
      logger?.info('✅ [monday.com Deadlines] Found upcoming deadlines', { 
        totalUpcoming: upcomingTasks.length,
        workspacesSearched: workspaceList,
      });
      
      return {
        upcomingTasks,
        totalUpcoming: upcomingTasks.length,
        workspacesSearched: workspaceList.length > 0 ? workspaceList : ['Main Workspace'],
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
      boardId: z.string(),
      workspaceName: z.string().optional(),
      workspaceId: z.string().optional(),
      itemId: z.string(),
      itemName: z.string(),
      url: z.string().describe("Direct link to the task in Monday.com"),
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
    workspacesSearched: z.array(z.string()),
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
          boards (limit: 50) {
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
            items_page (limit: 20) {
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
                  assets {
                    id
                    name
                    url
                    file_extension
                  }
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
        return { items: [], totalItems: 0, totalFiles: 0, totalUpdates: 0, workspacesSearched: [] };
      }
      
      logger?.info('📄 [monday.com Docs] API Response received', { 
        boardsCount: data.boards.length,
        sampleBoardStructure: data.boards[0] ? {
          hasBoardName: !!data.boards[0].name,
          hasWorkspace: !!data.boards[0].workspace,
          hasColumns: !!data.boards[0].columns,
          hasItemsPage: !!data.boards[0].items_page,
          itemsCount: data.boards[0].items_page?.items?.length || 0,
          firstItemHasAssets: data.boards[0].items_page?.items?.[0]?.assets !== undefined,
          firstItemAssetsCount: data.boards[0].items_page?.items?.[0]?.assets?.length || 0,
        } : null
      });
      
      logger?.info('📄 [monday.com Docs] Processing results', { boardsCount: data.boards.length });
      
      const keywords = extractKeywords(context.searchQuery);
      logger?.info('📄 [monday.com Docs] Extracted keywords', { 
        originalQuery: context.searchQuery,
        keywords 
      });
      
      const allItems: any[] = [];
      let totalFiles = 0;
      let totalUpdates = 0;
      const workspacesFound = new Set<string>();
      
      data.boards.forEach((board: any) => {
        const workspace = board.workspace || {};
        if (workspace.name) {
          workspacesFound.add(workspace.name);
        }
        logger?.debug('📄 [monday.com Docs] Processing board', { 
          boardName: board.name,
          workspaceName: workspace.name || 'Main Workspace',
          workspaceId: workspace.id || 'null'
        });
        const items = board.items_page?.items || [];
        const columns = board.columns || [];
        
        const columnTitleMap = new Map<string, ColumnInfo>(
          columns.map((col: any) => [col.id, { title: col.title, type: col.type }])
        );
        
        items.forEach((item: any, itemIndex: number) => {
          const assets = item.assets || [];
          const updates = item.updates || [];
          const columnValues = item.column_values || [];
          
          logger?.debug('🔍 [monday.com Docs] Processing item', {
            boardName: board.name,
            itemIndex,
            itemName: item.name,
            itemId: item.id,
            hasAssets: assets.length > 0,
            assetsCount: assets.length,
            assetsDetail: assets.length > 0 ? assets.slice(0, 3).map((a: any) => ({
              id: a.id,
              name: a.name,
              hasUrl: !!a.url,
              url: a.url?.substring(0, 100),
              fileExtension: a.file_extension,
            })) : 'No assets',
            updatesCount: updates.length,
            columnValuesCount: columnValues.length,
            fileColumnCount: columnValues.filter((col: any) => {
              const colInfo = columnTitleMap.get(col.id);
              return colInfo?.type === 'file';
            }).length,
          });
          
          // LENIENT MATCHING: Check if ANY keywords appear in the item
          // Use relevance scoring to rank exact matches and multi-keyword matches higher
          const exactPhraseMatch = 
            item.name?.toLowerCase().includes(context.searchQuery.toLowerCase()) ||
            assets.some((asset: any) => asset.name?.toLowerCase().includes(context.searchQuery.toLowerCase())) ||
            updates.some((update: any) => update.text_body?.toLowerCase().includes(context.searchQuery.toLowerCase()));
          
          let shouldIncludeItem = false;
          
          if (exactPhraseMatch) {
            // Exact phrase match - always include
            shouldIncludeItem = true;
          } else {
            // Check if ANY keywords appear as whole words in the item
            const allText = [
              item.name || '',
              ...assets.map((a: any) => a.name || ''),
              ...updates.map((u: any) => u.text_body || ''),
              ...columnValues.map((c: any) => c.text || ''),
            ].join(' ');
            
            // Include if ANY keyword matches as a whole word
            shouldIncludeItem = keywords.some(keyword => matchesWholeWord(allText, keyword));
          }
          
          logger?.debug('🔍 [monday.com Docs] Match results for item', {
            itemName: item.name,
            keywordsCount: keywords.length,
            willInclude: shouldIncludeItem,
          });
          
          if (shouldIncludeItem) {
            // Extract files from assets array
            const filesFromAssets = context.includeFiles ? assets.map((asset: any) => ({
              id: asset.id,
              name: asset.name || 'Unnamed file',
              url: asset.url,
              extension: asset.file_extension || '',
            })) : [];
            
            // Extract files from updates (files attached to comments/posts)
            const filesFromUpdates: any[] = [];
            if (context.includeFiles && context.includeUpdates && updates.length > 0) {
              updates.forEach((update: any) => {
                if (update.assets && Array.isArray(update.assets)) {
                  update.assets.forEach((asset: any) => {
                    if (asset.url && asset.name) {
                      filesFromUpdates.push({
                        id: asset.id,
                        name: asset.name || 'Unnamed file',
                        url: asset.url,
                        extension: asset.file_extension || '',
                      });
                    }
                  });
                }
              });
              
              if (filesFromUpdates.length > 0) {
                logger?.info('📎 [monday.com Docs] Extracted files from updates', {
                  itemName: item.name,
                  updatesCount: updates.length,
                  filesExtracted: filesFromUpdates.length,
                  fileSample: filesFromUpdates.slice(0, 3).map((f: any) => ({ name: f.name, hasUrl: !!f.url })),
                });
              }
            }
            
            // Extract files from file-type columns
            const filesFromColumns: any[] = [];
            if (context.includeFiles) {
              // Log all column types to understand what's available
              logger?.info('📋 [monday.com Docs] Analyzing item columns', {
                itemName: item.name,
                totalColumns: columnValues.length,
                columnTypes: columnValues.map((col: any) => {
                  const colInfo = columnTitleMap.get(col.id);
                  return {
                    id: col.id,
                    title: colInfo?.title || 'unknown',
                    type: colInfo?.type || 'unknown',
                    hasValue: !!col.value,
                    hasText: !!col.text,
                  };
                }),
              });
              
              const fileColumns = columnValues.filter((col: any) => {
                const colInfo = columnTitleMap.get(col.id);
                return colInfo?.type === 'file';
              });
              
              if (fileColumns.length > 0) {
                logger?.debug('📁 [monday.com Docs] Found file columns on item', {
                  itemName: item.name,
                  fileColumnsCount: fileColumns.length,
                  fileColumnsDetail: fileColumns.map((col: any) => {
                    const colInfo = columnTitleMap.get(col.id);
                    return {
                      columnId: col.id,
                      columnTitle: colInfo?.title || 'unknown',
                      columnType: colInfo?.type,
                      hasValue: !!col.value,
                      hasText: !!col.text,
                      valuePreview: col.value?.substring(0, 200),
                    };
                  }),
                });
              }
              
              // Parse file column values (they contain JSON with file data)
              fileColumns.forEach((col: any) => {
                if (col.value) {
                  try {
                    const parsedValue = JSON.parse(col.value);
                    
                    logger?.debug('📁 [monday.com Docs] Parsing file column value', {
                      itemName: item.name,
                      columnId: col.id,
                      columnTitle: columnTitleMap.get(col.id)?.title || 'unknown',
                      parsedStructure: {
                        hasFiles: !!parsedValue.files,
                        filesCount: parsedValue.files?.length || 0,
                      },
                    });
                    
                    if (parsedValue.files && Array.isArray(parsedValue.files)) {
                      parsedValue.files.forEach((file: any) => {
                        if (file.assetId && file.name) {
                          // Construct Monday.com file URL
                          // Monday.com file URLs follow pattern: https://files.monday.com/asset/{assetId}/{filename}
                          const fileUrl = file.url || `https://files.monday.com/asset/${file.assetId}/${encodeURIComponent(file.name)}`;
                          
                          filesFromColumns.push({
                            id: file.assetId,
                            name: file.name,
                            url: fileUrl,
                            extension: file.fileType || '',
                          });
                        }
                      });
                      
                      logger?.info('📁 [monday.com Docs] Extracted files from file column', {
                        itemName: item.name,
                        columnTitle: columnTitleMap.get(col.id)?.title || 'unknown',
                        filesExtracted: parsedValue.files.length,
                        fileSample: parsedValue.files.slice(0, 3).map((f: any) => ({ 
                          name: f.name, 
                          hasAssetId: !!f.assetId,
                          hasUrl: !!f.url,
                        })),
                      });
                    }
                  } catch (parseError) {
                    logger?.warn('⚠️ [monday.com Docs] Failed to parse file column value', {
                      itemName: item.name,
                      columnId: col.id,
                      error: parseError instanceof Error ? parseError.message : String(parseError),
                      valuePreview: col.value?.substring(0, 100),
                    });
                  }
                }
              });
            }
            
            // Combine files from all sources: assets, file columns, and updates
            const files = [...filesFromAssets, ...filesFromUpdates, ...filesFromColumns];
            
            logger?.info('📎 [monday.com Docs] Total files extracted from item', {
              itemName: item.name,
              includeFiles: context.includeFiles,
              filesFromAssets: filesFromAssets.length,
              filesFromUpdates: filesFromUpdates.length,
              filesFromColumns: filesFromColumns.length,
              totalFilesExtracted: files.length,
              fileSample: files.slice(0, 3).map((f: any) => ({ name: f.name, hasUrl: !!f.url })),
            });
            
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
            
            const relevanceScore = calculateRelevance(item, keywords, assets, updates, columnValues, columnTitleMap, context.searchQuery);
            
            // MINIMUM SCORE THRESHOLD: Filter out weak matches
            // Exact phrase matches get 100+ score, multi-keyword matches get 20+ score
            // Single keyword + file/update matches get 4-10 points (pass through)
            // Pure single keyword match gets only 3 points (filtered out)
            const MINIMUM_RELEVANCE_SCORE = 4;
            
            if (relevanceScore < MINIMUM_RELEVANCE_SCORE) {
              logger?.debug('❌ [monday.com Docs] Item filtered out - relevance too low', {
                itemName: item.name,
                relevanceScore,
                minimumRequired: MINIMUM_RELEVANCE_SCORE,
              });
              return; // Skip this item - not relevant enough
            }
            
            // Only count files and updates from items that pass the relevance threshold
            totalFiles += files.length;
            totalUpdates += itemUpdates.length;
            
            const mondaySubdomain = process.env.MONDAY_SUBDOMAIN || 'stirlingmarketing';
            const taskUrl = `https://${mondaySubdomain}.monday.com/boards/${board.id}/pulses/${item.id}`;
            
            allItems.push({
              boardName: board.name,
              boardId: board.id,
              workspaceName: workspace.name || 'Main Workspace',
              workspaceId: workspace.id?.toString() || null,
              itemId: item.id,
              itemName: item.name,
              url: taskUrl,
              state: item.state,
              relevanceScore,
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
      
      // Search for folders (e.g., "SM Playbook" docs folder)
      logger?.info('📁 [monday.com Folders] Fetching folders from all workspaces');
      
      try {
        const foldersData = await fetchFolders();
        const folders = foldersData?.folders || [];
        
        logger?.info('📁 [monday.com Folders] Retrieved folders', { 
          foldersCount: folders.length,
          folderNames: folders.slice(0, 10).map((f: any) => f.name),
        });
        
        // Apply keyword matching to folders (use for...of to support async/await)
        for (const folder of folders) {
          const folderName = folder.name || '';
          const folderNameLower = folderName.toLowerCase();
          
          let shouldIncludeFolder = false;
          
          // Check for exact phrase match
          const exactPhraseMatch = folderNameLower.includes(context.searchQuery.toLowerCase());
          
          if (exactPhraseMatch) {
            shouldIncludeFolder = true;
          } else {
            // Include if ANY keyword matches as a whole word
            shouldIncludeFolder = keywords.some(keyword => matchesWholeWord(folderName, keyword));
          }
          
          logger?.debug('🔍 [monday.com Folders] Checking folder', {
            folderName,
            exactPhraseMatch,
            keywordsMatched: keywords.filter(k => matchesWholeWord(folderName, k)),
            shouldIncludeFolder,
          });
          
          if (shouldIncludeFolder) {
            // Calculate relevance score for folder (same logic as items)
            let score = 0;
            
            // Exact phrase match
            if (folderNameLower.includes(context.searchQuery.toLowerCase())) {
              score += 100;
            }
            
            // Multi-keyword matches
            const keywordsInName = keywords.filter(keyword => matchesWholeWord(folderName, keyword));
            if (keywordsInName.length >= 2) {
              score += keywordsInName.length * 10;
            } else if (keywordsInName.length === 1) {
              score += 5; // Increased from 3 to ensure it passes the threshold
            }
            
            const MINIMUM_RELEVANCE_SCORE = 4;
            
            if (score >= MINIMUM_RELEVANCE_SCORE) {
              logger?.info('📁 [monday.com Folders] Folder matched - fetching documents inside', {
                folderName,
                folderId: folder.id,
                relevanceScore: score,
              });
              
              // Fetch actual documents from this folder
              try {
                const docsData = await fetchDocsFromFolder(folder.id, folder.workspace?.id?.toString());
                const docs = docsData?.docs || [];
                
                logger?.info('📄 [monday.com Folders] Retrieved documents from folder', {
                  folderName,
                  folderId: folder.id,
                  docsCount: docs.length,
                  docNames: docs.slice(0, 5).map((d: any) => d.name),
                });
                
                // Add each document as a separate result with its direct URL
                docs.forEach((doc: any) => {
                  // Calculate document score (inherit folder score + boost for exact doc name match)
                  let docScore = score; // Inherit folder's relevance
                  
                  const docNameLower = doc.name?.toLowerCase() || '';
                  if (docNameLower.includes(context.searchQuery.toLowerCase())) {
                    docScore += 50; // Boost if doc name matches search query
                  }
                  
                  allItems.push({
                    type: 'document',
                    documentId: doc.id?.toString() || '',
                    documentName: doc.name,
                    documentUrl: doc.url,
                    documentKind: doc.doc_kind,
                    parentFolderName: folder.name,
                    parentFolderId: folder.id?.toString() || '',
                    createdAt: doc.created_at,
                    updatedAt: doc.updated_at,
                    relevanceScore: docScore,
                    boardName: `Document in ${folder.name}`,
                    boardId: '',
                    workspaceName: folder.workspace?.name || '',
                    workspaceId: doc.workspace_id?.toString() || folder.workspace?.id?.toString() || '',
                    itemId: doc.id?.toString() || '',
                    itemName: doc.name,
                    state: '',
                    taskInfo: {
                      columnValues: [{
                        title: 'Folder',
                        text: folder.name,
                        value: folder.id?.toString() || '',
                      }],
                    },
                    documentation: {
                      files: [],
                      docColumns: [],
                      updates: [],
                    },
                  });
                });
                
                // If no docs found in the folder, add a placeholder noting the folder exists
                if (docs.length === 0) {
                  logger?.info('📁 [monday.com Folders] No documents found in folder, adding folder reference', {
                    folderName,
                    folderId: folder.id,
                  });
                  
                  allItems.push({
                    type: 'folder',
                    folderId: folder.id?.toString() || '',
                    folderName: folder.name,
                    folderUrl: `https://stirling-marketing-net.monday.com/docs/${folder.id}`,
                    relevanceScore: score,
                    boardName: 'Folder (empty)',
                    boardId: '',
                    workspaceName: folder.workspace?.name || '',
                    workspaceId: folder.workspace?.id?.toString() || '',
                    itemId: folder.id?.toString() || '',
                    itemName: folder.name,
                    state: '',
                    taskInfo: {
                      columnValues: [],
                    },
                    documentation: {
                      files: [],
                      docColumns: [],
                      updates: [],
                    },
                  });
                }
              } catch (docError: any) {
                logger?.warn('⚠️ [monday.com Folders] Failed to fetch documents from folder', {
                  folderName,
                  folderId: folder.id,
                  error: docError.message,
                });
                
                // Fallback to folder URL if doc fetch fails
                const folderUrl = `https://stirling-marketing-net.monday.com/docs/${folder.id}`;
                allItems.push({
                  type: 'folder',
                  folderId: folder.id?.toString() || '',
                  folderName: folder.name,
                  folderUrl,
                  relevanceScore: score,
                  boardName: 'Folder',
                  boardId: '',
                  workspaceName: folder.workspace?.name || '',
                  workspaceId: folder.workspace?.id?.toString() || '',
                  itemId: folder.id?.toString() || '',
                  itemName: folder.name,
                  state: '',
                  taskInfo: {
                    columnValues: [],
                  },
                  documentation: {
                    files: [],
                    docColumns: [],
                    updates: [],
                  },
                });
              }
            }
          }
        }
      } catch (folderError: any) {
        logger?.warn('⚠️ [monday.com Folders] Failed to fetch folders', {
          error: folderError.message,
        });
        // Continue with item results even if folder search fails
      }
      
      allItems.sort((a, b) => b.relevanceScore - a.relevanceScore);
      
      const workspaceList = Array.from(workspacesFound);
      
      logger?.info('✅ [monday.com Docs] Search completed successfully', { 
        totalItems: allItems.length,
        totalFiles,
        totalUpdates,
        workspacesSearched: workspaceList,
        topResults: allItems.slice(0, 3).map(i => ({ name: i.itemName, score: i.relevanceScore }))
      });
      
      return {
        items: allItems,
        totalItems: allItems.length,
        totalFiles,
        totalUpdates,
        workspacesSearched: workspaceList.length > 0 ? workspaceList : ['Main Workspace'],
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

export const mondayListWorkspacesTool = createTool({
  id: "monday-list-workspaces",
  description: `List all available Monday.com workspaces. Use this when users ask about available workspaces, want to know what workspaces exist, or need to understand the workspace structure.`,
  
  inputSchema: z.object({}),
  
  outputSchema: z.object({
    workspaces: z.array(z.object({
      id: z.string(),
      name: z.string(),
      kind: z.string().optional(),
      description: z.string().optional(),
    })),
    totalWorkspaces: z.number(),
  }),
  
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🗂️ [monday.com Workspaces] Fetching workspace list');
    
    try {
      const query = `
        query {
          workspaces {
            id
            name
            kind
            description
          }
        }
      `;
      
      logger?.info('🗂️ [monday.com Workspaces] Querying API for workspaces');
      
      const data = await queryMonday(query);
      
      if (!data || !data.workspaces) {
        logger?.warn('⚠️ [monday.com Workspaces] No workspaces found');
        return { workspaces: [], totalWorkspaces: 0 };
      }
      
      const workspaces = data.workspaces.map((ws: any) => ({
        id: ws.id?.toString() || '',
        name: ws.name || 'Unnamed Workspace',
        kind: ws.kind || '',
        description: ws.description || '',
      }));
      
      logger?.info('✅ [monday.com Workspaces] Retrieved workspaces successfully', { 
        totalWorkspaces: workspaces.length,
        workspaceNames: workspaces.map((ws: any) => ws.name),
      });
      
      return {
        workspaces,
        totalWorkspaces: workspaces.length,
      };
    } catch (error: any) {
      logger?.error('❌ [monday.com Workspaces] Error occurred', { 
        error: error.message,
        stack: error.stack 
      });
      throw new Error(`monday.com workspace list failed: ${error.message}`);
    }
  },
});

export const mondayGetTasksByDateRangeTool = createTool({
  id: "monday-get-tasks-by-date-range",
  description: `Get Monday.com tasks filtered by specific date ranges for automated monitoring. Supports 'today', 'end-of-week' (Friday), and 'upcoming-week' ranges. Returns tasks with deadlines, assignees, status, and direct links.`,
  
  inputSchema: z.object({
    dateRange: z.enum(['today', 'end-of-week', 'upcoming-week']).describe("Date range to filter tasks: 'today' for same-day deadlines, 'end-of-week' for tasks due Friday, 'upcoming-week' for next 7 days"),
  }),
  
  outputSchema: z.object({
    tasks: z.array(z.object({
      boardName: z.string(),
      boardId: z.string(),
      boardUrl: z.string(),
      workspaceName: z.string(),
      itemName: z.string(),
      itemId: z.string(),
      itemUrl: z.string(),
      deadline: z.string(),
      deadlineFormatted: z.string(),
      assignees: z.array(z.string()),
      status: z.string(),
      priority: z.string().optional(),
    })),
    totalTasks: z.number(),
    dateRange: z.string(),
    queryDate: z.string(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('📅 [Monday Task Monitor] Fetching tasks by date range', { dateRange: context.dateRange });
    
    try {
      const now = new Date();
      let startDate: Date;
      let endDate: Date;
      let rangeDescription = '';
      
      // Calculate date ranges based on context
      if (context.dateRange === 'today') {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        rangeDescription = 'Today';
      } else if (context.dateRange === 'end-of-week') {
        // Find next Friday
        const dayOfWeek = now.getDay(); // 0 = Sunday, 5 = Friday
        const daysUntilFriday = dayOfWeek <= 5 ? 5 - dayOfWeek : 7 - dayOfWeek + 5;
        const friday = new Date(now);
        friday.setDate(now.getDate() + daysUntilFriday);
        startDate = new Date(friday.getFullYear(), friday.getMonth(), friday.getDate(), 0, 0, 0);
        endDate = new Date(friday.getFullYear(), friday.getMonth(), friday.getDate(), 23, 59, 59);
        rangeDescription = `End of Week (${friday.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })})`;
      } else { // 'upcoming-week'
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        endDate = new Date(now);
        endDate.setDate(endDate.getDate() + 7);
        endDate.setHours(23, 59, 59);
        rangeDescription = 'Upcoming Week (7 days)';
      }
      
      logger?.info('📅 [Monday Task Monitor] Date range calculated', { 
        range: context.dateRange,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        description: rangeDescription
      });
      
      const query = `
        query {
          boards (limit: 100) {
            id
            name
            board_kind
            workspace {
              id
              name
            }
            columns {
              id
              title
              type
            }
            items_page (limit: 500) {
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
      
      logger?.info('📅 [Monday Task Monitor] Querying Monday.com API');
      
      const data = await queryMonday(query);
      
      if (!data || !data.boards) {
        logger?.warn('⚠️ [Monday Task Monitor] No boards found');
        return { 
          tasks: [], 
          totalTasks: 0, 
          dateRange: rangeDescription,
          queryDate: now.toISOString()
        };
      }
      
      const tasks: any[] = [];
      
      // Process all boards and items
      data.boards.forEach((board: any) => {
        const workspace = board.workspace || {};
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
                
                // Check if deadline falls within the specified range
                if (deadline >= startDate && deadline <= endDate) {
                  // Get assignees if available
                  const peopleColumns = item.column_values?.filter((col: any) => col.type === 'people');
                  const assignees = peopleColumns?.flatMap((col: any) => {
                    try {
                      const peopleValue = JSON.parse(col.value || '{}');
                      return peopleValue.personsAndTeams?.map((p: any) => p.name || p.id) || [];
                    } catch {
                      return col.text ? [col.text] : [];
                    }
                  }) || [];
                  
                  // Get priority if available
                  const priorityColumns = item.column_values?.filter((col: any) => {
                    const colInfo = columnMap.get(col.id);
                    return colInfo?.title?.toLowerCase().includes('priority');
                  });
                  const priority = priorityColumns?.[0]?.text || 'Not set';
                  
                  // Format the deadline nicely
                  const deadlineFormatted = deadline.toLocaleDateString('en-US', {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  });
                  
                  tasks.push({
                    boardName: board.name,
                    boardId: board.id,
                    boardUrl: `https://stirling-marketing-net.monday.com/boards/${board.id}`,
                    workspaceName: workspace.name || 'Main Workspace',
                    itemName: item.name,
                    itemId: item.id,
                    itemUrl: `https://stirling-marketing-net.monday.com/boards/${board.id}/pulses/${item.id}`,
                    deadline: deadline.toISOString(),
                    deadlineFormatted,
                    assignees: assignees.filter((a: any) => a && typeof a === 'string' && a.trim()),
                    status: item.state || 'Unknown',
                    priority,
                  });
                }
              }
            } catch (e) {
              // Skip invalid date values
              logger?.debug('⚠️ [Monday Task Monitor] Skipped invalid date value', { error: e });
            }
          });
        });
      });
      
      // Sort by deadline (soonest first)
      tasks.sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
      
      logger?.info('✅ [Monday Task Monitor] Tasks retrieved successfully', { 
        totalTasks: tasks.length,
        dateRange: rangeDescription,
        sampleTasks: tasks.slice(0, 3).map(t => ({ name: t.itemName, deadline: t.deadlineFormatted }))
      });
      
      return {
        tasks,
        totalTasks: tasks.length,
        dateRange: rangeDescription,
        queryDate: now.toISOString(),
      };
    } catch (error: any) {
      logger?.error('❌ [Monday Task Monitor] Error occurred', { 
        error: error.message,
        stack: error.stack 
      });
      throw new Error(`Monday.com task monitoring failed: ${error.message}`);
    }
  },
});
