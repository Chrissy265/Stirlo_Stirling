import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Client } from '@microsoft/microsoft-graph-client';

/**
 * SharePoint Search Tool
 * 
 * Searches for documents and files across the entire SharePoint organization
 * using Microsoft Graph Search API with app-only authentication.
 */

interface TokenCache {
  access_token: string;
  expires_at: number;
}

let tokenCache: TokenCache | null = null;

/**
 * Get OAuth2 access token using client credentials flow (app-only authentication)
 * This allows full organizational access without user delegation
 */
async function getAccessToken() {
  const logger = console;
  
  // Check if we have a valid cached token
  if (tokenCache && tokenCache.expires_at > Date.now()) {
    logger.log('🔐 [SharePoint Auth] Using cached access token');
    return tokenCache.access_token;
  }
  
  const tenantId = process.env.SHAREPOINT_TENANT_ID;
  const clientId = process.env.SHAREPOINT_CLIENT_ID;
  const clientSecret = process.env.SHAREPOINT_CLIENT_SECRET;
  
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('SharePoint credentials not configured. Required: SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, SHAREPOINT_CLIENT_SECRET');
  }
  
  logger.log('🔐 [SharePoint Auth] Acquiring new access token via client credentials flow');
  
  const tokenEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  
  try {
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token acquisition failed: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    // Cache the token (expires_in is in seconds, we subtract 5 minutes for safety)
    tokenCache = {
      access_token: data.access_token,
      expires_at: Date.now() + ((data.expires_in - 300) * 1000),
    };
    
    logger.log('✅ [SharePoint Auth] Access token acquired successfully');
    return tokenCache.access_token;
  } catch (error: any) {
    logger.error('❌ [SharePoint Auth] Token acquisition failed', error);
    throw new Error(`Failed to acquire SharePoint access token: ${error.message}`);
  }
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
  description: `Search for documents and files across the entire SharePoint organization using full-text content search. Use this when users ask about documents, files, policies, reports, or any content stored in SharePoint. Searches file names, content, metadata, authors, and more.`,
  
  inputSchema: z.object({
    query: z.string().describe("The search query (keywords, filename, content to find). Supports natural language queries."),
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
      siteName: z.string().optional(),
      contentSnippet: z.string().optional(),
    })),
    totalResults: z.number(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔍 [SharePoint Search] Starting organizational search', { query: context.query, limit: context.limit });
    
    try {
      const client = await getSharePointClient();
      
      logger?.info('🔍 [SharePoint Search] Using Microsoft Search API');
      
      // Use Microsoft Search API for comprehensive organization-wide search
      // This searches across all SharePoint sites, libraries, and content
      const searchRequest = {
        requests: [
          {
            entityTypes: ['driveItem'],
            query: {
              queryString: context.query,
            },
            from: 0,
            size: Math.min(context.limit || 10, 25),
            fields: [
              'id',
              'name',
              'webUrl',
              'lastModifiedDateTime',
              'createdBy',
              'fileSystemInfo',
              'file',
              'parentReference',
            ],
            region: 'AUS',
          },
        ],
      };
      
      logger?.info('🔍 [SharePoint Search] Executing search request', { searchRequest });
      
      const searchResponse = await client
        .api('/search/query')
        .post(searchRequest);
      
      logger?.info('🔍 [SharePoint Search] Search response received', { 
        hasValue: !!searchResponse?.value,
        valueLength: searchResponse?.value?.length 
      });
      
      const searchResults = searchResponse?.value?.[0]?.hitsContainers?.[0]?.hits || [];
      
      logger?.info('🔍 [SharePoint Search] Processing results', { resultsFound: searchResults.length });
      
      const results = searchResults.map((hit: any) => {
        const resource = hit.resource;
        const summary = hit.summary || '';
        
        return {
          id: resource.id || '',
          name: resource.name || 'Unknown',
          webUrl: resource.webUrl || '',
          lastModified: resource.lastModifiedDateTime || '',
          createdBy: resource.createdBy?.user?.displayName || 'Unknown',
          summary: resource.name || '',
          fileType: resource.name?.split('.').pop() || 'unknown',
          siteName: resource.parentReference?.sharepointIds?.siteUrl?.split('/').filter((s: string) => s).pop() || 'Unknown Site',
          contentSnippet: summary,
        };
      });
      
      logger?.info('✅ [SharePoint Search] Results processed successfully', { 
        totalResults: results.length,
        fileTypes: results.map((r: any) => r.fileType),
        sites: results.map((r: any) => r.siteName)
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
      
      // Provide more helpful error messages
      if (error.message.includes('credentials')) {
        throw new Error('SharePoint credentials are not properly configured. Please verify SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, and SHAREPOINT_CLIENT_SECRET are set correctly.');
      }
      
      throw new Error(`SharePoint search failed: ${error.message}`);
    }
  },
});
