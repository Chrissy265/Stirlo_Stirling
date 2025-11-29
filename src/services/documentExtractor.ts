import { Client } from '@microsoft/microsoft-graph-client';
import type { Task, TaskAsset } from '../monday/types.js';
import type { DocumentLink } from '../types/monitoring.js';

interface TokenCache {
  access_token: string;
  expires_at: number;
}

let tokenCache: TokenCache | null = null;

async function getSharePointAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expires_at > Date.now()) {
    return tokenCache.access_token;
  }
  
  const tenantId = process.env.SHAREPOINT_TENANT_ID;
  const clientId = process.env.SHAREPOINT_CLIENT_ID;
  const clientSecret = process.env.SHAREPOINT_CLIENT_SECRET;
  
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('SharePoint credentials not configured');
  }
  
  const tokenEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  
  if (!response.ok) {
    throw new Error(`SharePoint auth failed: ${response.status}`);
  }
  
  const data = await response.json();
  tokenCache = {
    access_token: data.access_token,
    expires_at: Date.now() + ((data.expires_in - 300) * 1000),
  };
  
  return tokenCache.access_token;
}

async function getSharePointClient(): Promise<Client> {
  const accessToken = await getSharePointAccessToken();
  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => accessToken
    }
  });
}

export class DocumentExtractor {
  private sharePointEnabled = false;

  constructor() {
    this.sharePointEnabled = !!(
      process.env.SHAREPOINT_TENANT_ID &&
      process.env.SHAREPOINT_CLIENT_ID &&
      process.env.SHAREPOINT_CLIENT_SECRET
    );
    
    console.log(`📁 [DocumentExtractor] Initialized. SharePoint enabled: ${this.sharePointEnabled}`);
  }

  async extractRelatedDocuments(task: Task): Promise<DocumentLink[]> {
    console.log(`🔍 [DocumentExtractor] Extracting documents for task: "${task.name}"`);
    
    const documents: DocumentLink[] = [];
    
    const mondayDocs = this.extractFromMondayAssets(task);
    documents.push(...mondayDocs);
    console.log(`📎 [DocumentExtractor] Found ${mondayDocs.length} Monday.com attachments`);
    
    if (this.sharePointEnabled) {
      try {
        const sharePointDocs = await this.searchSharePoint(task);
        documents.push(...sharePointDocs);
        console.log(`📁 [DocumentExtractor] Found ${sharePointDocs.length} SharePoint documents`);
      } catch (error: any) {
        console.warn(`⚠️ [DocumentExtractor] SharePoint search failed: ${error.message}`);
      }
    }
    
    const uniqueDocs = this.deduplicateDocuments(documents);
    console.log(`✅ [DocumentExtractor] Total unique documents: ${uniqueDocs.length}`);
    
    return uniqueDocs;
  }

  private extractFromMondayAssets(task: Task): DocumentLink[] {
    const documents: DocumentLink[] = [];
    
    for (const asset of task.assets || []) {
      documents.push({
        id: asset.id,
        name: asset.name,
        url: asset.url,
        source: 'Monday.com',
        fileType: asset.fileExtension || this.getFileType(asset.name),
      });
    }
    
    for (const [colId, colValue] of Object.entries(task.columnValues || {})) {
      if (colValue.type === 'file' && colValue.value?.files) {
        for (const file of colValue.value.files) {
          documents.push({
            id: file.assetId?.toString() || file.fileId || `file-${colId}`,
            name: file.name || 'Unknown file',
            url: file.publicUrl || file.url || '',
            source: 'Monday.com',
            fileType: file.fileExtension || this.getFileType(file.name),
          });
        }
      }
    }
    
    return documents;
  }

  private async searchSharePoint(task: Task): Promise<DocumentLink[]> {
    const keywords = this.extractKeywords(task.name);
    if (keywords.length === 0) {
      return [];
    }
    
    const searchQuery = keywords.slice(0, 5).join(' ');
    console.log(`🔍 [DocumentExtractor] SharePoint search query: "${searchQuery}"`);
    
    try {
      const client = await getSharePointClient();
      
      const searchRequest = {
        requests: [
          {
            entityTypes: ['driveItem'],
            query: { queryString: searchQuery },
            from: 0,
            size: 5,
            fields: ['id', 'name', 'webUrl', 'lastModifiedDateTime', 'file'],
            region: 'AUS',
          },
        ],
      };
      
      const searchResponse = await client.api('/search/query').post(searchRequest);
      const hits = searchResponse?.value?.[0]?.hitsContainers?.[0]?.hits || [];
      
      const documents: DocumentLink[] = hits.map((hit: any) => {
        const resource = hit.resource;
        return {
          id: resource.id || '',
          name: resource.name || 'Unknown',
          url: resource.webUrl || '',
          source: 'SharePoint' as const,
          fileType: resource.name?.split('.').pop() || 'unknown',
        };
      });
      
      return documents;
    } catch (error: any) {
      console.error(`❌ [DocumentExtractor] SharePoint search error: ${error.message}`);
      return [];
    }
  }

  private extractKeywords(taskName: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
      'task', 'item', 'update', 'review', 'complete', 'done', 'todo',
      '-', '–', '—', '/', '\\', '|', ':', ';', ',', '.', '!', '?',
    ]);
    
    const words = taskName
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
    
    return [...new Set(words)];
  }

  private deduplicateDocuments(documents: DocumentLink[]): DocumentLink[] {
    const seen = new Map<string, DocumentLink>();
    
    for (const doc of documents) {
      const key = doc.url.toLowerCase() || `${doc.source}-${doc.name}`.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, doc);
      }
    }
    
    return Array.from(seen.values());
  }

  private getFileType(fileName: string): string {
    if (!fileName) return 'unknown';
    const parts = fileName.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'unknown';
  }

  async searchDocumentsByKeywords(keywords: string[], limit: number = 10): Promise<DocumentLink[]> {
    if (!this.sharePointEnabled) {
      console.log(`⚠️ [DocumentExtractor] SharePoint not configured, skipping keyword search`);
      return [];
    }

    const searchQuery = keywords.slice(0, 5).join(' ');
    console.log(`🔍 [DocumentExtractor] Keyword search: "${searchQuery}"`);

    try {
      const client = await getSharePointClient();
      
      const searchRequest = {
        requests: [
          {
            entityTypes: ['driveItem'],
            query: { queryString: searchQuery },
            from: 0,
            size: Math.min(limit, 25),
            fields: ['id', 'name', 'webUrl', 'lastModifiedDateTime', 'file'],
            region: 'AUS',
          },
        ],
      };
      
      const searchResponse = await client.api('/search/query').post(searchRequest);
      const hits = searchResponse?.value?.[0]?.hitsContainers?.[0]?.hits || [];
      
      return hits.map((hit: any) => {
        const resource = hit.resource;
        return {
          id: resource.id || '',
          name: resource.name || 'Unknown',
          url: resource.webUrl || '',
          source: 'SharePoint' as const,
          fileType: resource.name?.split('.').pop() || 'unknown',
        };
      });
    } catch (error: any) {
      console.error(`❌ [DocumentExtractor] Keyword search error: ${error.message}`);
      return [];
    }
  }
}

export const documentExtractor = new DocumentExtractor();
