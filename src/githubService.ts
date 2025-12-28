import * as vscode from 'vscode';
import { Octokit } from '@octokit/rest';
import { GitHubUser } from './types';

export class GitHubService {
    private session: vscode.AuthenticationSession | undefined;
    private octokit: Octokit | undefined;
    private cache: {
        followers?: GitHubUser[];
        following?: GitHubUser[];
        timestamp?: number;
    } = {};
    private readonly CACHE_TTL = 15 * 60 * 1000; // 15 minutes

    /**
     * Authenticate with GitHub
     */
    async authenticate(): Promise<vscode.AuthenticationSession> {
        this.session = await vscode.authentication.getSession(
            'github',
            ['user:email', 'read:user'],
            { createIfNone: true }
        );

        this.octokit = new Octokit({
            auth: this.session.accessToken
        });

        return this.session;
    }

    /**
     * Get current user profile
     */
    async getProfile(): Promise<GitHubUser> {
        if (!this.octokit) {
            throw new Error('Not authenticated');
        }

        const { data } = await this.octokit.users.getAuthenticated();
        return {
            id: data.id,
            login: data.login,
            avatar_url: data.avatar_url,
            name: data.name || undefined
        };
    }

    /**
     * Get followers (paginated)
     */
    async getFollowers(): Promise<GitHubUser[]> {
        if (this.cache.followers && this.cache.timestamp && 
            Date.now() - this.cache.timestamp < this.CACHE_TTL) {
            return this.cache.followers;
        }

        if (!this.octokit) {
            throw new Error('Not authenticated');
        }

        const users: GitHubUser[] = [];
        let page = 1;

        while (true) {
            const { data } = await this.octokit.users.listFollowersForAuthenticatedUser({
                per_page: 100,
                page
            });

            if (data.length === 0) break;

            users.push(...data.map(u => ({
                id: u.id,
                login: u.login,
                avatar_url: u.avatar_url
            })));

            if (data.length < 100) break;
            page++;
        }

        this.cache.followers = users;
        this.cache.timestamp = Date.now();
        return users;
    }

    /**
     * Get following (paginated)
     */
    async getFollowing(): Promise<GitHubUser[]> {
        if (this.cache.following && this.cache.timestamp &&
            Date.now() - this.cache.timestamp < this.CACHE_TTL) {
            return this.cache.following;
        }

        if (!this.octokit) {
            throw new Error('Not authenticated');
        }

        const users: GitHubUser[] = [];
        let page = 1;

        while (true) {
            const { data } = await this.octokit.users.listFollowedByAuthenticatedUser({
                per_page: 100,
                page
            });

            if (data.length === 0) break;

            users.push(...data.map(u => ({
                id: u.id,
                login: u.login,
                avatar_url: u.avatar_url
            })));

            if (data.length < 100) break;
            page++;
        }

        this.cache.following = users;
        return users;
    }

    /**
     * Get access token
     */
    getToken(): string | undefined {
        return this.session?.accessToken;
    }

    /**
     * Sign out
     */
    async signOut(): Promise<void> {
        this.session = undefined;
        this.octokit = undefined;
        this.cache = {};
    }

    /**
     * Check if authenticated
     */
    isAuthenticated(): boolean {
        return !!this.session;
    }
}
