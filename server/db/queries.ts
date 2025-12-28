import { db } from './index';
import { users, relationships, manualConnections, inviteCodes, preferences, aliases } from './schema';
import { eq, and, or } from 'drizzle-orm';

// Types
interface User {
    id: number;
    githubId: number | null;
    username: string;
    avatar: string | null;
    createdAt: Date;
    lastSeen: Date;
}

interface Relationship {
    id: number;
    relatedGithubId: number;
}

interface ManualConnection {
    user: string;
}

// ========== USERS ==========

export async function upsertUser(githubId: number, username: string, avatar?: string) {
    const existing = await db.select().from(users).where(eq(users.githubId, githubId)).limit(1);
    
    if (existing.length > 0) {
        await db.update(users)
            .set({ username, avatar, lastSeen: new Date() })
            .where(eq(users.githubId, githubId));
        return existing[0];
    } else {
        const result = await db.insert(users)
            .values({ githubId, username, avatar })
            .returning();
        return result[0];
    }
}

export async function updateLastSeen(githubId: number) {
    await db.update(users)
        .set({ lastSeen: new Date() })
        .where(eq(users.githubId, githubId));
}

export async function getUserByUsername(username: string) {
    const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return result[0] || null;
}

export async function getUserByGithubId(githubId: number) {
    const result = await db.select().from(users).where(eq(users.githubId, githubId)).limit(1);
    return result[0] || null;
}

// ========== RELATIONSHIPS ==========

export async function upsertRelationships(userId: number, rels: { githubId: number; type: 'follower' | 'following' }[]) {
    // Delete existing
    await db.delete(relationships).where(eq(relationships.userId, userId));
    
    // Insert new
    if (rels.length > 0) {
        await db.insert(relationships).values(
            rels.map(r => ({
                userId,
                relatedGithubId: r.githubId,
                type: r.type
            }))
        );
    }
}

export async function getFollowers(userId: number): Promise<number[]> {
    const result = await db.select({ id: relationships.relatedGithubId })
        .from(relationships)
        .where(and(eq(relationships.userId, userId), eq(relationships.type, 'follower')));
    return result.map((r: Relationship) => r.id);
}

export async function getFollowing(userId: number): Promise<number[]> {
    const result = await db.select({ id: relationships.relatedGithubId })
        .from(relationships)
        .where(and(eq(relationships.userId, userId), eq(relationships.type, 'following')));
    return result.map((r: Relationship) => r.id);
}

// ========== MANUAL CONNECTIONS ==========

export async function addManualConnection(user1: string, user2: string) {
    // Add both directions
    await db.insert(manualConnections)
        .values([
            { user1, user2 },
            { user1: user2, user2: user1 }
        ])
        .onConflictDoNothing();
}

export async function removeManualConnection(user1: string, user2: string) {
    await db.delete(manualConnections)
        .where(or(
            and(eq(manualConnections.user1, user1), eq(manualConnections.user2, user2)),
            and(eq(manualConnections.user1, user2), eq(manualConnections.user2, user1))
        ));
}

export async function getManualConnections(username: string): Promise<string[]> {
    const result = await db.select({ user: manualConnections.user2 })
        .from(manualConnections)
        .where(eq(manualConnections.user1, username));
    return result.map((r: ManualConnection) => r.user);
}

export async function isManuallyConnected(user1: string, user2: string): Promise<boolean> {
    const result = await db.select()
        .from(manualConnections)
        .where(and(eq(manualConnections.user1, user1), eq(manualConnections.user2, user2)))
        .limit(1);
    return result.length > 0;
}

// ========== INVITE CODES ==========

function generateCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export async function createInviteCode(creatorUsername: string, expiresInHours: number = 48) {
    const code = generateCode();
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
    
    await db.insert(inviteCodes).values({
        code,
        creatorUsername,
        expiresAt
    });
    
    return code;
}

export async function getInviteCode(code: string) {
    const result = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code)).limit(1);
    return result[0] || null;
}

export async function acceptInviteCode(code: string, acceptorUsername: string): Promise<{ success: boolean; creator?: string; error?: string }> {
    const invite = await getInviteCode(code);
    
    if (!invite) {
        return { success: false, error: 'Invalid code' };
    }
    
    if (invite.usedBy) {
        return { success: false, error: 'Code already used' };
    }
    
    if (new Date() > invite.expiresAt) {
        return { success: false, error: 'Code expired' };
    }
    
    if (invite.creatorUsername === acceptorUsername) {
        return { success: false, error: 'Cannot accept your own invite' };
    }
    
    // Mark as used
    await db.update(inviteCodes)
        .set({ usedBy: acceptorUsername, usedAt: new Date() })
        .where(eq(inviteCodes.code, code));
    
    // Create connection
    await addManualConnection(invite.creatorUsername, acceptorUsername);
    
    return { success: true, creator: invite.creatorUsername };
}

// ========== PREFERENCES ==========

export async function getPreferences(userId: number) {
    const result = await db.select().from(preferences).where(eq(preferences.userId, userId)).limit(1);
    
    if (result.length === 0) {
        // Create default
        await db.insert(preferences).values({ userId });
        return {
            userId,
            visibilityMode: 'everyone',
            shareProject: true,
            shareLanguage: true,
            shareActivity: true
        };
    }
    
    return result[0];
}

export async function updatePreferences(userId: number, prefs: Partial<{
    visibilityMode: string;
    shareProject: boolean;
    shareLanguage: boolean;
    shareActivity: boolean;
}>) {
    await db.update(preferences).set(prefs).where(eq(preferences.userId, userId));
}

// ========== ALIASES ==========

export async function createAlias(githubUsername: string, guestUsername: string, githubId: number) {
    await db.insert(aliases)
        .values({ githubUsername, guestUsername, githubId })
        .onConflictDoUpdate({
            target: aliases.githubUsername,
            set: { guestUsername, githubId }
        });
}

export async function resolveUsername(username: string): Promise<string> {
    // Check if this is a guest username with an alias
    const result = await db.select({ github: aliases.githubUsername })
        .from(aliases)
        .where(eq(aliases.guestUsername, username))
        .limit(1);
    
    return result[0]?.github || username;
}
