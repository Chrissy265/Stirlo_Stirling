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
      
      logger?.info('🔍 [SharePoint Search] Getting user drives');
      
      // First, get all available drives (OneDrive and SharePoint sites)
      let allResults: any[] = [];
      
      try {
        // Get the user's OneDrive
        const myDriveResponse = await client.api('/me/drive').get();
        if (myDriveResponse?.id) {
          logger?.info('🔍 [SharePoint Search] Searching in OneDrive', { driveId: myDriveResponse.id });
          
          // Search within OneDrive
          const searchResponse = await client
            .api(`/drives/${myDriveResponse.id}/root/search(q='${context.query}')`)
            .top(context.limit || 10)
            .get();
          
          if (searchResponse?.value) {
            allResults = allResults.concat(searchResponse.value);
          }
        }
      } catch (driveError: any) {
        logger?.warn('⚠️ [SharePoint Search] Could not access OneDrive', { error: driveError.message });
      }
      
      // Try to get shared drives/sites
      try {
        const sitesResponse = await client.api('/sites?search=*').top(10).get();
        
        if (sitesResponse?.value) {
          logger?.info('🔍 [SharePoint Search] Found sites', { count: sitesResponse.value.length });
          
          // Search in each site's default drive
          for (const site of sitesResponse.value.slice(0, 3)) { // Limit to first 3 sites for performance
            try {
              const siteId = site.id;
              const driveResponse = await client.api(`/sites/${siteId}/drive`).get();
              
              if (driveResponse?.id) {
                const siteSearchResponse = await client
                  .api(`/drives/${driveResponse.id}/root/search(q='${context.query}')`)
                  .top(context.limit || 10)
                  .get();
                
                if (siteSearchResponse?.value) {
                  allResults = allResults.concat(siteSearchResponse.value);
                }
              }
            } catch (siteError: any) {
              logger?.warn('⚠️ [SharePoint Search] Could not search site', { 
                siteId: site.id,
                error: siteError.message 
              });
            }
          }
        }
      } catch (sitesError: any) {
        logger?.warn('⚠️ [SharePoint Search] Could not access sites', { error: sitesError.message });
      }
      
      logger?.info('🔍 [SharePoint Search] Search completed', { resultsFound: allResults.length });
      
      // Process and deduplicate results
      const seenIds = new Set();
      const results = allResults
        .filter((item: any) => {
          if (seenIds.has(item.id)) return false;
          seenIds.add(item.id);
          return true;
        })
        .slice(0, context.limit || 10)
        .map((item: any) => ({
          id: item.id || '',
          name: item.name || 'Unknown',
          webUrl: item.webUrl || '',
          lastModified: item.lastModifiedDateTime || '',
          createdBy: item.createdBy?.user?.displayName || 'Unknown',
          summary: item.name || '',
          fileType: item.name?.split('.').pop() || 'unknown',
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
