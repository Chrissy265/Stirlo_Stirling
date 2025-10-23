import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import OpenAI from "openai";
import pkg from 'pg';
const { Pool } = pkg;

/**
 * RAG (Retrieval Augmented Generation) Tool
 * 
 * Provides semantic search over historical conversations using OpenAI embeddings
 * and PostgreSQL pgvector for similarity matching
 */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return response.data[0].embedding;
}

export const ragSearchTool = createTool({
  id: "rag-semantic-search",
  description: `Search through historical conversations and documentation using semantic search. Use this when users ask about past discussions, previous decisions, or want to find related information from conversation history.`,
  
  inputSchema: z.object({
    query: z.string().describe("The search query to find semantically similar past conversations"),
    limit: z.number().optional().default(5).describe("Maximum number of results to return (default: 5)"),
  }),
  
  outputSchema: z.object({
    results: z.array(z.object({
      conversationId: z.string(),
      userMessage: z.string(),
      assistantResponse: z.string(),
      similarity: z.number(),
      createdAt: z.string(),
    })),
    totalResults: z.number(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔍 [RAG Search] Starting semantic search', { 
      query: context.query, 
      limit: context.limit 
    });
    
    try {
      // Generate embedding for the search query
      logger?.info('🔍 [RAG Search] Generating query embedding');
      const queryEmbedding = await generateEmbedding(context.query);
      
      // Perform similarity search using pgvector
      logger?.info('🔍 [RAG Search] Searching vector database');
      const result = await pool.query(
        `SELECT 
           conversation_id,
           user_message,
           assistant_response,
           created_at,
           1 - (embedding <=> $1) AS similarity
         FROM conversation_embeddings
         ORDER BY embedding <=> $1
         LIMIT $2`,
        [JSON.stringify(queryEmbedding), context.limit]
      );
      
      const results = result.rows.map((row: any) => ({
        conversationId: row.conversation_id,
        userMessage: row.user_message,
        assistantResponse: row.assistant_response,
        similarity: parseFloat(row.similarity),
        createdAt: row.created_at.toISOString(),
      }));
      
      logger?.info('✅ [RAG Search] Search completed successfully', { 
        resultsFound: results.length,
        topSimilarity: results[0]?.similarity 
      });
      
      return {
        results,
        totalResults: results.length,
      };
    } catch (error: any) {
      logger?.error('❌ [RAG Search] Error occurred', { 
        error: error.message,
        stack: error.stack 
      });
      throw new Error(`RAG search failed: ${error.message}`);
    }
  },
});

export const ragStoreTool = createTool({
  id: "rag-store-conversation",
  description: `Store a conversation exchange in the vector database for future semantic search. Use this to save important conversations for later retrieval.`,
  
  inputSchema: z.object({
    conversationId: z.string().describe("Unique identifier for this conversation thread"),
    userMessage: z.string().describe("The user's message"),
    assistantResponse: z.string().describe("The assistant's response"),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    id: z.number(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('💾 [RAG Store] Storing conversation', { 
      conversationId: context.conversationId 
    });
    
    try {
      // Combine user message and assistant response for embedding
      const textToEmbed = `User: ${context.userMessage}\nAssistant: ${context.assistantResponse}`;
      
      logger?.info('💾 [RAG Store] Generating embedding');
      const embedding = await generateEmbedding(textToEmbed);
      
      logger?.info('💾 [RAG Store] Inserting into database');
      const result = await pool.query(
        `INSERT INTO conversation_embeddings 
         (conversation_id, user_message, assistant_response, embedding) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id`,
        [context.conversationId, context.userMessage, context.assistantResponse, JSON.stringify(embedding)]
      );
      
      logger?.info('✅ [RAG Store] Conversation stored successfully', { 
        id: result.rows[0].id 
      });
      
      return {
        success: true,
        id: result.rows[0].id,
      };
    } catch (error: any) {
      logger?.error('❌ [RAG Store] Error occurred', { 
        error: error.message,
        stack: error.stack 
      });
      throw new Error(`RAG store failed: ${error.message}`);
    }
  },
});
