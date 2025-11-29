import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { userMappings } from '../../db/schema.js';
import type { UserMapping } from '../../types/monitoring.js';

export class UserMappingRepository {
  async getSlackUserId(mondayUserId: string): Promise<string | null> {
    const result = await db
      .select({ slackUserId: userMappings.slackUserId })
      .from(userMappings)
      .where(eq(userMappings.mondayUserId, mondayUserId))
      .limit(1);

    return result[0]?.slackUserId || null;
  }

  async getMondayUserId(slackUserId: string): Promise<string | null> {
    const result = await db
      .select({ mondayUserId: userMappings.mondayUserId })
      .from(userMappings)
      .where(eq(userMappings.slackUserId, slackUserId))
      .limit(1);

    return result[0]?.mondayUserId || null;
  }

  async upsert(
    mondayUserId: string,
    slackUserId: string,
    displayName?: string,
    mondayEmail?: string
  ): Promise<void> {
    await db
      .insert(userMappings)
      .values({
        mondayUserId,
        slackUserId,
        displayName,
        mondayEmail,
        isActive: true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userMappings.mondayUserId,
        set: {
          slackUserId,
          displayName,
          mondayEmail,
          isActive: true,
          updatedAt: new Date(),
        },
      });
  }

  async getAll(): Promise<UserMapping[]> {
    const results = await db
      .select()
      .from(userMappings)
      .where(eq(userMappings.isActive, true));

    return results.map(this.mapToUserMapping);
  }

  async getByMondayId(mondayUserId: string): Promise<UserMapping | null> {
    const result = await db
      .select()
      .from(userMappings)
      .where(eq(userMappings.mondayUserId, mondayUserId))
      .limit(1);

    return result[0] ? this.mapToUserMapping(result[0]) : null;
  }

  async getBySlackId(slackUserId: string): Promise<UserMapping | null> {
    const result = await db
      .select()
      .from(userMappings)
      .where(eq(userMappings.slackUserId, slackUserId))
      .limit(1);

    return result[0] ? this.mapToUserMapping(result[0]) : null;
  }

  async deactivate(mondayUserId: string): Promise<void> {
    await db
      .update(userMappings)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(userMappings.mondayUserId, mondayUserId));
  }

  async delete(mondayUserId: string): Promise<void> {
    await db
      .delete(userMappings)
      .where(eq(userMappings.mondayUserId, mondayUserId));
  }

  private mapToUserMapping(row: typeof userMappings.$inferSelect): UserMapping {
    return {
      id: row.id,
      mondayUserId: row.mondayUserId,
      slackUserId: row.slackUserId,
      mondayEmail: row.mondayEmail,
      displayName: row.displayName,
      isActive: row.isActive ?? true,
      createdAt: row.createdAt ?? undefined,
      updatedAt: row.updatedAt ?? undefined,
    };
  }
}

export const userMappingRepository = new UserMappingRepository();
