import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { mondaySearchWithDocsTool } from "./mondayTool";
import { sharepointSearchTool } from "./sharepointSearchTool";

/**
 * Helper function to format file URLs as Slack hyperlinks
 * Converts: {name: "file.pdf", url: "https://..."}
 * To: "<https://...|file.pdf>"
 */
function formatSlackHyperlink(name: string, url: string): string {
  if (!url) return name;
  // Slack hyperlink format: <URL|Display Text>
  return `<${url}|${name}>`;
}

/**
 * Internal Search Orchestrator Tool
 * 
 * Enforces mandatory search priority order:
 * 1. ALWAYS searches Monday.com first (tasks, files, documentation)
 * 2. ALWAYS searches SharePoint second (organization-wide documents)
 * 3. Returns combined results with file URLs formatted as Slack hyperlinks
 * 
 * This tool guarantees both internal sources are checked before the agent responds,
 * ensuring users never miss relevant internal information.
 */
export const internalSearchOrchestratorTool = createTool({
  id: "internal-search-orchestrator",
  description: `Search internal company resources with enforced priority order. This tool AUTOMATICALLY searches Monday.com first, then SharePoint, and returns combined results. Use this for ANY query about documents, tasks, files, projects, or company information. The tool ensures comprehensive coverage of all internal sources.`,
  
  inputSchema: z.object({
    query: z.string().describe("The search query - what the user is looking for (documents, tasks, information, etc.)"),
  }),
  
  outputSchema: z.object({
    mondayResults: z.object({
      items: z.array(z.any()),
      totalItems: z.number(),
      workspacesSearched: z.array(z.string()),
      filesFound: z.number(),
    }),
    sharepointResults: z.object({
      results: z.array(z.any()),
      totalResults: z.number(),
    }),
    searchOrder: z.array(z.string()).describe("Order in which sources were searched"),
    combinedSummary: z.object({
      totalMondayItems: z.number(),
      totalSharePointDocuments: z.number(),
      totalFilesWithUrls: z.number(),
      sourcesSearched: z.array(z.string()),
    }),
    formattedFileLinks: z.array(z.object({
      source: z.string(),
      fileName: z.string(),
      slackHyperlink: z.string(),
      rawUrl: z.string(),
    })).describe("All file URLs formatted as Slack-clickable hyperlinks"),
  }),
  
  execute: async ({ context, mastra, runtimeContext }) => {
    const logger = mastra?.getLogger();
    const searchQuery = context.query;
    
    logger?.info('🔍 [Internal Search Orchestrator] Starting comprehensive internal search', {
      query: searchQuery,
      enforcedOrder: ['Monday.com', 'SharePoint'],
    });
    
    const searchOrder: string[] = [];
    const formattedFileLinks: Array<{
      source: string;
      fileName: string;
      slackHyperlink: string;
      rawUrl: string;
    }> = [];
    
    // ==========================================
    // STEP 1: Search Monday.com (MANDATORY FIRST)
    // ==========================================
    
    logger?.info('📋 [Orchestrator] STEP 1: Searching Monday.com with documentation', {
      query: searchQuery,
      tool: 'mondaySearchWithDocsTool',
    });
    
    const mondayStartTime = Date.now();
    searchOrder.push('Monday.com');
    
    let mondayResults: any;
    try {
      mondayResults = await mondaySearchWithDocsTool.execute({
        context: { 
          searchQuery,
          includeFiles: true,
          includeUpdates: true,
        },
        mastra,
        runtimeContext,
      });
      
      const mondayDuration = Date.now() - mondayStartTime;
      logger?.info('✅ [Orchestrator] Monday.com search completed', {
        duration: `${mondayDuration}ms`,
        itemsFound: mondayResults.items?.length || 0,
        workspaces: mondayResults.workspacesSearched?.length || 0,
      });
      
      // Extract and format Monday.com file URLs as Slack hyperlinks
      if (mondayResults.items) {
        mondayResults.items.forEach((item: any) => {
          if (item.documentation?.files) {
            item.documentation.files.forEach((file: any) => {
              if (file.url) {
                formattedFileLinks.push({
                  source: `Monday.com - ${item.workspaceName} - ${item.boardName}`,
                  fileName: file.name,
                  slackHyperlink: formatSlackHyperlink(file.name, file.url),
                  rawUrl: file.url,
                });
              }
            });
          }
        });
      }
      
    } catch (error: any) {
      logger?.error('❌ [Orchestrator] Monday.com search failed', {
        error: error.message,
      });
      mondayResults = {
        items: [],
        totalItems: 0,
        workspacesSearched: [],
        totalFiles: 0,
        totalUpdates: 0,
      };
    }
    
    // ==========================================
    // STEP 2: Search SharePoint (MANDATORY SECOND)
    // ==========================================
    
    logger?.info('📄 [Orchestrator] STEP 2: Searching SharePoint documents', {
      query: searchQuery,
      tool: 'sharepointSearchTool',
      note: 'Searching regardless of Monday.com results',
    });
    
    const sharepointStartTime = Date.now();
    searchOrder.push('SharePoint');
    
    let sharepointResults: any;
    try {
      sharepointResults = await sharepointSearchTool.execute({
        context: { 
          query: searchQuery,
          limit: 15,
        },
        mastra,
        runtimeContext,
      });
      
      const sharepointDuration = Date.now() - sharepointStartTime;
      logger?.info('✅ [Orchestrator] SharePoint search completed', {
        duration: `${sharepointDuration}ms`,
        documentsFound: sharepointResults.results?.length || 0,
      });
      
      // Extract and format SharePoint file URLs as Slack hyperlinks
      if (sharepointResults.results) {
        sharepointResults.results.forEach((doc: any) => {
          if (doc.webUrl) {
            formattedFileLinks.push({
              source: `SharePoint - ${doc.siteName || 'Unknown Site'}`,
              fileName: doc.name,
              slackHyperlink: formatSlackHyperlink(doc.name, doc.webUrl),
              rawUrl: doc.webUrl,
            });
          }
        });
      }
      
    } catch (error: any) {
      logger?.error('❌ [Orchestrator] SharePoint search failed', {
        error: error.message,
      });
      sharepointResults = {
        results: [],
        totalResults: 0,
      };
    }
    
    // ==========================================
    // STEP 3: Combine and Return Results
    // ==========================================
    
    const combinedSummary = {
      totalMondayItems: mondayResults.items?.length || 0,
      totalSharePointDocuments: sharepointResults.results?.length || 0,
      totalFilesWithUrls: formattedFileLinks.length,
      sourcesSearched: searchOrder,
    };
    
    logger?.info('✅ [Orchestrator] Internal search orchestration complete', {
      summary: combinedSummary,
      fileLinksGenerated: formattedFileLinks.length,
      searchOrder,
    });
    
    logger?.info('📎 [Orchestrator] File hyperlinks ready for Slack', {
      totalLinks: formattedFileLinks.length,
      sampleLinks: formattedFileLinks.slice(0, 3).map(f => f.slackHyperlink),
    });
    
    return {
      mondayResults: {
        items: mondayResults.items || [],
        totalItems: mondayResults.totalItems || 0,
        workspacesSearched: mondayResults.workspacesSearched || [],
        filesFound: mondayResults.totalFiles || 0,
      },
      sharepointResults: {
        results: sharepointResults.results || [],
        totalResults: sharepointResults.totalResults || 0,
      },
      searchOrder,
      combinedSummary,
      formattedFileLinks,
    };
  },
});
