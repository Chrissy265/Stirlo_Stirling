import { WebClient } from '@slack/web-api';
import type { MondayUser } from '../monday/types.js';
import { MondayWorkspaceManager } from '../monday/workspaceManager.js';
import { UserMappingRepository } from '../database/repositories/userMappingRepository.js';

interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  profile?: {
    email?: string;
    display_name?: string;
    real_name?: string;
  };
  deleted?: boolean;
  is_bot?: boolean;
}

export class UserMappingSync {
  private slackClient: WebClient | null = null;

  constructor(
    private mondayManager: MondayWorkspaceManager,
    private userMappingRepo: UserMappingRepository
  ) {
    const slackToken = process.env.SLACK_BOT_TOKEN;
    if (slackToken) {
      this.slackClient = new WebClient(slackToken);
      console.log(`👥 [UserMappingSync] Initialized with Slack client`);
    } else {
      console.warn(`⚠️ [UserMappingSync] No SLACK_BOT_TOKEN, user sync disabled`);
    }
  }

  async syncUsers(): Promise<{ matched: number; total: number }> {
    if (!this.slackClient) {
      console.warn(`⚠️ [UserMappingSync] No Slack client, skipping sync`);
      return { matched: 0, total: 0 };
    }

    console.log(`🔄 [UserMappingSync] Starting user sync...`);

    const slackUsers = await this.getSlackUsers();
    console.log(`👥 [UserMappingSync] Found ${slackUsers.length} Slack users`);

    const mondayUsers = this.getMondayUsers();
    console.log(`👥 [UserMappingSync] Found ${mondayUsers.length} Monday.com users`);

    let matched = 0;

    for (const mondayUser of mondayUsers) {
      const slackUser = this.findMatchingSlackUser(mondayUser, slackUsers);
      
      if (slackUser) {
        await this.userMappingRepo.upsert(
          mondayUser.id,
          slackUser.id,
          mondayUser.name,
          mondayUser.email
        );
        matched++;
        console.log(`✅ [UserMappingSync] Matched: ${mondayUser.name} (Monday) <-> ${slackUser.real_name || slackUser.name} (Slack)`);
      }
    }

    console.log(`✅ [UserMappingSync] Sync complete. Matched ${matched}/${mondayUsers.length} users`);
    return { matched, total: mondayUsers.length };
  }

  private async getSlackUsers(): Promise<SlackUser[]> {
    if (!this.slackClient) return [];

    try {
      const result = await this.slackClient.users.list({});
      const members = (result.members || []) as SlackUser[];
      
      return members.filter(user => 
        !user.deleted && 
        !user.is_bot && 
        user.id !== 'USLACKBOT'
      );
    } catch (error: any) {
      console.error(`❌ [UserMappingSync] Failed to get Slack users: ${error.message}`);
      return [];
    }
  }

  private getMondayUsers(): MondayUser[] {
    return this.mondayManager.getAllCachedUsers();
  }

  private findMatchingSlackUser(mondayUser: MondayUser, slackUsers: SlackUser[]): SlackUser | null {
    const emailMatch = slackUsers.find(slack => 
      slack.profile?.email?.toLowerCase() === mondayUser.email?.toLowerCase()
    );
    if (emailMatch) {
      console.log(`📧 [UserMappingSync] Email match: ${mondayUser.email}`);
      return emailMatch;
    }

    const mondayName = this.normalizeName(mondayUser.name);
    
    for (const slack of slackUsers) {
      const slackRealName = this.normalizeName(slack.real_name || '');
      const slackDisplayName = this.normalizeName(slack.profile?.display_name || '');
      const slackProfileName = this.normalizeName(slack.profile?.real_name || '');
      
      if (this.namesMatch(mondayName, slackRealName) ||
          this.namesMatch(mondayName, slackDisplayName) ||
          this.namesMatch(mondayName, slackProfileName)) {
        console.log(`📝 [UserMappingSync] Name match: ${mondayUser.name} <-> ${slack.real_name || slack.name}`);
        return slack;
      }
    }

    return null;
  }

  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim();
  }

  private namesMatch(name1: string, name2: string): boolean {
    if (!name1 || !name2) return false;
    
    if (name1 === name2) return true;
    
    const parts1 = name1.split(/\s+/).filter(p => p.length > 1);
    const parts2 = name2.split(/\s+/).filter(p => p.length > 1);
    
    if (parts1.length >= 2 && parts2.length >= 2) {
      const firstName1 = parts1[0];
      const lastName1 = parts1[parts1.length - 1];
      const firstName2 = parts2[0];
      const lastName2 = parts2[parts2.length - 1];
      
      if (firstName1 === firstName2 && lastName1 === lastName2) {
        return true;
      }
    }
    
    const partsInCommon = parts1.filter(p => parts2.includes(p));
    if (partsInCommon.length >= 2) {
      return true;
    }
    
    return false;
  }

  async getSlackUserIdForMondayUser(mondayUserId: string): Promise<string | null> {
    const mapping = await this.userMappingRepo.getByMondayId(mondayUserId);
    return mapping?.slackUserId || null;
  }

  async getMondayUserIdForSlackUser(slackUserId: string): Promise<string | null> {
    const mapping = await this.userMappingRepo.getBySlackId(slackUserId);
    return mapping?.mondayUserId || null;
  }

  async manualLink(mondayUserId: string, slackUserId: string, displayName?: string): Promise<void> {
    const mondayUser = this.mondayManager.getUserById(mondayUserId);
    await this.userMappingRepo.upsert(
      mondayUserId,
      slackUserId,
      displayName || mondayUser?.name,
      mondayUser?.email
    );
    console.log(`🔗 [UserMappingSync] Manually linked Monday user ${mondayUserId} to Slack user ${slackUserId}`);
  }

  async getAllMappings(): Promise<{ mondayUserId: string; slackUserId: string; displayName?: string | null }[]> {
    const mappings = await this.userMappingRepo.getAll();
    return mappings.map(m => ({
      mondayUserId: m.mondayUserId,
      slackUserId: m.slackUserId,
      displayName: m.displayName,
    }));
  }
}
