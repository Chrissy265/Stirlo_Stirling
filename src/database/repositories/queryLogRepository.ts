import { eq, desc, gte } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { queryLog } from '../../db/schema.js';
import type { QueryLogEntry } from '../../types/monitoring.js';

export class QueryLogRepository {
  async create(entry: QueryLogEntry): Promise<void> {
    await db.insert(queryLog).values({
      userId: entry.userId,
      userName: entry.userName,
      query: entry.query,
      intent: entry.intent,
      channel: entry.channel,
      resultsCount: entry.resultsCount,
      responseTimeMs: entry.responseTimeMs,
      timestamp: entry.timestamp,
    });
  }

  async getRecent(limit: number = 50): Promise<QueryLogEntry[]> {
    const results = await db
      .select()
      .from(queryLog)
      .orderBy(desc(queryLog.timestamp))
      .limit(limit);

    return results.map(this.mapToQueryLogEntry);
  }

  async getByUser(userId: string, limit: number = 20): Promise<QueryLogEntry[]> {
    const results = await db
      .select()
      .from(queryLog)
      .where(eq(queryLog.userId, userId))
      .orderBy(desc(queryLog.timestamp))
      .limit(limit);

    return results.map(this.mapToQueryLogEntry);
  }

  async getByChannel(channel: string, limit: number = 50): Promise<QueryLogEntry[]> {
    const results = await db
      .select()
      .from(queryLog)
      .where(eq(queryLog.channel, channel))
      .orderBy(desc(queryLog.timestamp))
      .limit(limit);

    return results.map(this.mapToQueryLogEntry);
  }

  async getSince(since: Date): Promise<QueryLogEntry[]> {
    const results = await db
      .select()
      .from(queryLog)
      .where(gte(queryLog.timestamp, since))
      .orderBy(desc(queryLog.timestamp));

    return results.map(this.mapToQueryLogEntry);
  }

  async getStats(since: Date): Promise<{
    totalQueries: number;
    uniqueUsers: number;
    avgResponseTimeMs: number;
    avgResultsCount: number;
  }> {
    const entries = await this.getSince(since);
    
    if (entries.length === 0) {
      return {
        totalQueries: 0,
        uniqueUsers: 0,
        avgResponseTimeMs: 0,
        avgResultsCount: 0,
      };
    }

    const uniqueUsers = new Set(entries.map(e => e.userId)).size;
    const responseTimes = entries.filter(e => e.responseTimeMs != null).map(e => e.responseTimeMs!);
    const avgResponseTimeMs = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : 0;
    const avgResultsCount = Math.round(
      entries.reduce((a, b) => a + b.resultsCount, 0) / entries.length
    );

    return {
      totalQueries: entries.length,
      uniqueUsers,
      avgResponseTimeMs,
      avgResultsCount,
    };
  }

  async deleteOld(beforeDate: Date): Promise<number> {
    const result = await db
      .delete(queryLog)
      .where(eq(queryLog.timestamp, beforeDate));

    return result.rowCount || 0;
  }

  private mapToQueryLogEntry(row: typeof queryLog.$inferSelect): QueryLogEntry {
    return {
      id: row.id,
      userId: row.userId,
      userName: row.userName,
      query: row.query,
      intent: row.intent,
      channel: row.channel,
      resultsCount: row.resultsCount ?? 0,
      responseTimeMs: row.responseTimeMs,
      timestamp: row.timestamp ?? new Date(),
    };
  }
}

export const queryLogRepository = new QueryLogRepository();
