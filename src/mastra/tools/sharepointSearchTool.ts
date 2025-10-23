import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Client } from '@microsoft/microsoft-graph-client';

/**
 * SharePoint Search Tool
 * 
 * Searches for documents and files across the entire SharePoint organization
 * using Microsoft Graph API.
 */

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=sharepoint',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('SharePoint not connected');
  }
  return accessToken;
}

async function getSharePointClient() {
  const accessToken = await getAccessToken();

  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => accessToken
    }
  });
}

export const sharepointSearchTool = createTool({
  id: "sharepoint-search",
  description: `Search for documents and files across the SharePoint organization. Use this when users ask about documents, files, policies, reports, or any content stored in SharePoint. Can search by filename, content, author, or keywords.`,
  
  inputSchema: z.object({
    query: z.string().describe("The search query (keywords, filename, content to find)"),
    limit: z.number().optional().default(10).describe("Maximum number of results to return (default: 10, max: 25)"),
  }),
  
  outputSchema: z.object({
    results: z.array(z.object({
      id: z.string(),
      name: z.string(),
      webUrl: z.string(),
      lastModified: z.string(),
      createdBy: z.string().optional(),
      summary: z.string().optional(),
      fileType: z.string().optional(),
    })),
    totalResults: z.number(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔍 [SharePoint Search] Starting search', { query: context.query, limit: context.limit });
    
    try {
      const client = await getSharePointClient();
      
      // Use Microsoft Graph Search API to find documents
      const requestBody = {
        requests: [
          {
            entityTypes: ['driveItem', 'listItem'],
            query: {
              queryString: context.query,
            },
            from: 0,
            size: Math.min(context.limit || 10, 25),
          },
        ],
      };
      
      logger?.info('🔍 [SharePoint Search] Sending search request to Graph API');
      
      const response = await client
        .api('/search/query')
        .post(requestBody);
      
      const hits = response.value?.[0]?.hitsContainers?.[0]?.hits || [];
      
      logger?.info('🔍 [SharePoint Search] Search completed', { resultsFound: hits.length });
      
      const results = hits.map((hit: any) => ({
        id: hit.resource?.id || '',
        name: hit.resource?.name || 'Unknown',
        webUrl: hit.resource?.webUrl || '',
        lastModified: hit.resource?.lastModifiedDateTime || '',
        createdBy: hit.resource?.createdBy?.user?.displayName || 'Unknown',
        summary: hit.summary || '',
        fileType: hit.resource?.name?.split('.').pop() || 'unknown',
      }));
      
      logger?.info('✅ [SharePoint Search] Results processed successfully', { 
        totalResults: results.length,
        fileTypes: results.map((r: any) => r.fileType)
      });
      
      return {
        results,
        totalResults: results.length,
      };
    } catch (error: any) {
      logger?.error('❌ [SharePoint Search] Error occurred', { 
        error: error.message,
        stack: error.stack 
      });
      throw new Error(`SharePoint search failed: ${error.message}`);
    }
  },
});
