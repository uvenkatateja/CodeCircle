import { pgTable, serial, text, integer, boolean, timestamp, primaryKey, varchar } from 'drizzle-orm/pg-core';

// Users table
export const users = pgTable('users', {
    id: serial('id').primaryKey(),
    githubId: integer('github_id').unique(),
    username: varchar('username', { length: 255 }).notNull().unique(),
    avatar: text('avatar'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    lastSeen: timestamp('last_seen').defaultNow().notNull()
});

// User relationships (followers/following)
export const relationships = pgTable('relationships', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id),
    relatedGithubId: integer('related_github_id').notNull(),
    type: varchar('type', { length: 20 }).notNull() // 'follower' or 'following'
});

// Manual connections (via invite codes)
export const manualConnections = pgTable('manual_connections', {
    user1: varchar('user1', { length: 255 }).notNull(),
    user2: varchar('user2', { length: 255 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull()
}, (table: any) => ({
    pk: primaryKey({ columns: [table.user1, table.user2] })
}));

// Invite codes
export const inviteCodes = pgTable('invite_codes', {
    code: varchar('code', { length: 6 }).primaryKey(),
    creatorUsername: varchar('creator_username', { length: 255 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    usedBy: varchar('used_by', { length: 255 }),
    usedAt: timestamp('used_at')
});

// User preferences
export const preferences = pgTable('preferences', {
    userId: integer('user_id').primaryKey().references(() => users.id),
    visibilityMode: varchar('visibility_mode', { length: 20 }).default('everyone').notNull(),
    shareProject: boolean('share_project').default(true).notNull(),
    shareLanguage: boolean('share_language').default(true).notNull(),
    shareActivity: boolean('share_activity').default(true).notNull()
});

// Username aliases (guest -> github mapping)
export const aliases = pgTable('aliases', {
    githubUsername: varchar('github_username', { length: 255 }).primaryKey(),
    guestUsername: varchar('guest_username', { length: 255 }).notNull().unique(),
    githubId: integer('github_id').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull()
});

// Types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Preference = typeof preferences.$inferSelect;
export type InviteCode = typeof inviteCodes.$inferSelect;
