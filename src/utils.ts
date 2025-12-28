import * as vscode from 'vscode';
import { UserStatus, GitHubUser } from './types';

export const GUEST_AVATAR = 'https://avatars.githubusercontent.com/u/0?s=200&v=4';
// Update this after deploying your server to Railway
export const DEFAULT_SERVER = 'wss://codecircle-server.onrender.com';

/**
 * Create guest profile
 */
export function createGuestProfile(username: string): GitHubUser {
    return {
        id: 0,
        login: username,
        avatar_url: GUEST_AVATAR
    };
}

/**
 * Format last seen time
 */
export function formatLastSeen(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

/**
 * Build user description for tree item
 */
export function buildUserDescription(user: UserStatus): string {
    if (user.status === 'Offline') {
        return user.lastSeen ? `Last seen ${formatLastSeen(user.lastSeen)}` : 'Offline';
    }

    const parts: string[] = [];
    if (user.activity && user.activity !== 'Hidden') parts.push(user.activity);
    if (user.project && user.project !== 'Hidden') parts.push(user.project);
    if (user.language && user.language !== 'Hidden') parts.push(`(${user.language})`);

    return parts.join(' • ') || user.status;
}

/**
 * Build tooltip for user
 */
export function buildUserTooltip(user: UserStatus): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${user.username}**\n\n`);
    md.appendMarkdown(`Status: ${user.status}\n\n`);
    if (user.activity) md.appendMarkdown(`Activity: ${user.activity}\n\n`);
    if (user.project && user.project !== 'Hidden') md.appendMarkdown(`Project: ${user.project}\n\n`);
    if (user.language && user.language !== 'Hidden') md.appendMarkdown(`Language: ${user.language}`);
    return md;
}

/**
 * Get status icon
 */
export function getStatusIcon(status: string): vscode.ThemeIcon {
    switch (status) {
        case 'Online':
            return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
        case 'Away':
            return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.yellow'));
        default:
            return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('disabledForeground'));
    }
}

/**
 * Generate unique ID
 */
export function generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
