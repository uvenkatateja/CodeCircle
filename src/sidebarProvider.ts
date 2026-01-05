import * as vscode from 'vscode';
import { UserStatus, GitHubUser, ConnectionStatus, ChatMessage } from './types';
import { WsClient } from './wsClient';
import { GitHubService } from './githubService';
import { ChatStorage } from './chatStorage';
import { createGuestProfile, formatLastSeen } from './utils';

export class SidebarProvider implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _onUsersUpdated = new vscode.EventEmitter<UserStatus[]>();
    readonly onUsersUpdated = this._onUsersUpdated.event;

    private _onConnectionStatusChanged = new vscode.EventEmitter<ConnectionStatus>();
    readonly onConnectionStatusChanged = this._onConnectionStatusChanged.event;

    private context: vscode.ExtensionContext;
    private profile: GitHubUser;
    private allUsers: UserStatus[] = [];
    private wsClient: WsClient;
    private githubService: GitHubService;
    private chatStorage: ChatStorage;
    private followers: GitHubUser[] = [];
    private following: GitHubUser[] = [];
    private closeFriends: string[] = [];
    public isGitHubConnected: boolean = false;
    public isAuthenticated: boolean = false;
    private _connectionStatus: ConnectionStatus = 'disconnected';
    private onChatMessageCallback: ((message: ChatMessage) => void) | null = null;
    private recentChats: string[] = []; // Track users we've chatted with

    constructor(
        context: vscode.ExtensionContext,
        githubService: GitHubService
    ) {
        this.context = context;
        this.githubService = githubService;
        this.chatStorage = new ChatStorage(context);
        this.profile = { id: 0, login: '', avatar_url: '' };
        this.closeFriends = context.globalState.get<string[]>('closeFriends', []);
        this.recentChats = context.globalState.get<string[]>('recentChats', []);

        this.wsClient = new WsClient(
            (users) => {
                this.allUsers = users;
                this._onUsersUpdated.fire(users);
                this.refresh();
            },
            (status) => {
                this._connectionStatus = status;
                this._onConnectionStatusChanged.fire(status);
                this.refresh();
            },
            (message) => {
                this.chatStorage.saveIncomingMessage(message);
                this.addToRecentChats(message.from);
                if (this.onChatMessageCallback) {
                    this.onChatMessageCallback(message);
                }
            }
        );
    }

    private addToRecentChats(username: string) {
        if (username === this.profile.login) return;
        
        // Remove if exists, then add to front
        this.recentChats = this.recentChats.filter(u => u.toLowerCase() !== username.toLowerCase());
        this.recentChats.unshift(username);
        
        // Keep only last 10
        if (this.recentChats.length > 10) {
            this.recentChats = this.recentChats.slice(0, 10);
        }
        
        this.context.globalState.update('recentChats', this.recentChats);
        this.refresh();
    }

    get connectionStatus(): ConnectionStatus {
        return this._connectionStatus;
    }

    getWsClient(): WsClient {
        return this.wsClient;
    }

    getChatStorage(): ChatStorage {
        return this.chatStorage;
    }

    getProfile(): GitHubUser {
        return this.profile;
    }

    getAllUsers(): UserStatus[] {
        return this.allUsers;
    }

    getFollowers(): GitHubUser[] {
        return this.followers;
    }

    getFollowing(): GitHubUser[] {
        return this.following;
    }

    setOnChatMessage(callback: (message: ChatMessage) => void) {
        this.onChatMessageCallback = callback;
    }

    async connectGitHub(profile: GitHubUser, followers: GitHubUser[], following: GitHubUser[]) {
        this.profile = profile;
        this.followers = followers;
        this.following = following;
        this.isGitHubConnected = true;
        this.isAuthenticated = true;

        await this.context.globalState.update('authState', 'github');
        vscode.commands.executeCommand('setContext', 'codecircle.authenticated', true);
        vscode.commands.executeCommand('setContext', 'codecircle.githubConnected', true);

        const token = this.githubService.getToken();
        this.wsClient.connect(profile.login, token);
        this.refresh();
    }

    async connectAsGuest(username: string) {
        this.profile = createGuestProfile(username);
        this.followers = [];
        this.following = [];
        this.isGitHubConnected = false;
        this.isAuthenticated = true;

        await this.context.globalState.update('authState', 'guest');
        await this.context.globalState.update('guestUsername', username);
        vscode.commands.executeCommand('setContext', 'codecircle.authenticated', true);
        vscode.commands.executeCommand('setContext', 'codecircle.githubConnected', false);

        this.wsClient.connect(username);
        this.refresh();
    }

    async signOut() {
        this.wsClient.disconnect();
        this.profile = { id: 0, login: '', avatar_url: '' };
        this.followers = [];
        this.following = [];
        this.allUsers = [];
        this.isGitHubConnected = false;
        this.isAuthenticated = false;

        await this.context.globalState.update('authState', undefined);
        await this.context.globalState.update('guestUsername', undefined);
        await this.githubService.signOut();

        vscode.commands.executeCommand('setContext', 'codecircle.authenticated', false);
        vscode.commands.executeCommand('setContext', 'codecircle.githubConnected', false);
        this.refresh();
    }

    reconnect() {
        if (this.isAuthenticated) {
            this.wsClient.reconnect();
        }
    }

    updateStatus(status: Partial<UserStatus>) {
        this.wsClient.updateStatus(status);
    }

    sendMessage(data: any) {
        this.wsClient.send(data);
    }

    addCloseFriend(username: string) {
        if (!this.closeFriends.includes(username)) {
            this.closeFriends.push(username);
            this.context.globalState.update('closeFriends', this.closeFriends);
            this.refresh();
        }
    }

    removeCloseFriend(username: string) {
        const index = this.closeFriends.indexOf(username);
        if (index !== -1) {
            this.closeFriends.splice(index, 1);
            this.context.globalState.update('closeFriends', this.closeFriends);
            this.refresh();
        }
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeNode): Thenable<TreeNode[]> {
        if (!this.isAuthenticated) {
            return Promise.resolve([]);
        }

        if (element instanceof Category) {
            return Promise.resolve(this.getUsersForCategory(element.categoryType));
        }

        // Root level - return categories
        const onlineUsers = this.allUsers.filter(u => u.status === 'Online' || u.status === 'Away');
        const offlineUsers = this.allUsers.filter(u => u.status === 'Offline');
        const unreadCounts = this.chatStorage.getAllUnreadCounts();
        const dmUsers = this.getDMUsers();

        const categories: TreeNode[] = [];

        // Online section
        categories.push(new Category(
            `🟢 Online`,
            'online',
            onlineUsers.length,
            vscode.TreeItemCollapsibleState.Expanded
        ));

        // Offline section
        if (offlineUsers.length > 0) {
            categories.push(new Category(
                `⚫ Offline`,
                'offline',
                offlineUsers.length,
                vscode.TreeItemCollapsibleState.Collapsed
            ));
        }

        // Direct Messages section
        const totalUnread = Array.from(unreadCounts.values()).reduce((a, b) => a + b, 0);
        if (dmUsers.length > 0 || totalUnread > 0) {
            categories.push(new Category(
                totalUnread > 0 ? `💬 Messages (${totalUnread})` : `💬 Messages`,
                'dms',
                dmUsers.length,
                vscode.TreeItemCollapsibleState.Expanded
            ));
        }

        return Promise.resolve(categories);
    }

    private getDMUsers(): string[] {
        // Get users we've chatted with
        const unreadCounts = this.chatStorage.getAllUnreadCounts();
        const usersWithUnread = Array.from(unreadCounts.keys());
        
        // Combine with recent chats, prioritize unread
        const allDMUsers = [...new Set([...usersWithUnread, ...this.recentChats])];
        return allDMUsers.slice(0, 10);
    }

    private getUsersForCategory(categoryType: string): TreeNode[] {
        const unreadCounts = this.chatStorage.getAllUnreadCounts();

        switch (categoryType) {
            case 'online': {
                const users = this.allUsers
                    .filter(u => u.status === 'Online' || u.status === 'Away')
                    .filter(u => u.username !== this.profile.login);
                return users.map(u => new UserNode(u, unreadCounts.get(u.username.toLowerCase()) || 0));
            }

            case 'offline': {
                const users = this.allUsers
                    .filter(u => u.status === 'Offline')
                    .filter(u => u.username !== this.profile.login);
                return users.map(u => new UserNode(u, unreadCounts.get(u.username.toLowerCase()) || 0));
            }

            case 'dms': {
                const dmUsers = this.getDMUsers();
                return dmUsers.map(username => {
                    const user = this.allUsers.find(u => u.username.toLowerCase() === username.toLowerCase());
                    const unread = unreadCounts.get(username.toLowerCase()) || 0;
                    
                    if (user) {
                        return new DMNode(user, unread);
                    } else {
                        // User is offline or not in list
                        return new DMNode({
                            username,
                            status: 'Offline',
                            activity: '',
                            project: '',
                            language: ''
                        }, unread);
                    }
                });
            }

            default:
                return [];
        }
    }
}

// GitHub Network View Provider (simplified)
export class GitHubViewProvider implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private sidebarProvider: SidebarProvider) {
        sidebarProvider.onUsersUpdated(() => this.refresh());
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeNode): Thenable<TreeNode[]> {
        if (!this.sidebarProvider.isGitHubConnected) {
            return Promise.resolve([]);
        }

        if (element instanceof Category) {
            return Promise.resolve(this.getUsersForCategory(element.categoryType));
        }

        const followingUsers = this.getFollowingUsers();
        const followersUsers = this.getFollowersUsers();

        return Promise.resolve([
            new Category('Following', 'following', followingUsers.length, vscode.TreeItemCollapsibleState.Collapsed),
            new Category('Followers', 'followers', followersUsers.length, vscode.TreeItemCollapsibleState.Collapsed),
        ]);
    }

    private getUsersForCategory(categoryType: string): UserNode[] {
        const chatStorage = this.sidebarProvider.getChatStorage();
        const unreadCounts = chatStorage.getAllUnreadCounts();

        switch (categoryType) {
            case 'following':
                return this.getFollowingUsers().map(u => new UserNode(u, unreadCounts.get(u.username.toLowerCase()) || 0));
            case 'followers':
                return this.getFollowersUsers().map(u => new UserNode(u, unreadCounts.get(u.username.toLowerCase()) || 0));
            default:
                return [];
        }
    }

    private getFollowingUsers(): UserStatus[] {
        const logins = this.sidebarProvider.getFollowing().map(f => f.login.toLowerCase());
        return this.sidebarProvider.getAllUsers().filter(u => logins.includes(u.username.toLowerCase()));
    }

    private getFollowersUsers(): UserStatus[] {
        const logins = this.sidebarProvider.getFollowers().map(f => f.login.toLowerCase());
        return this.sidebarProvider.getAllUsers().filter(u => logins.includes(u.username.toLowerCase()));
    }
}

// Tree Node Types
type TreeNode = Category | UserNode | DMNode;

class Category extends vscode.TreeItem {
    constructor(
        label: string,
        public categoryType: string,
        count: number,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.description = count > 0 ? `${count}` : '';
        this.contextValue = 'category';
    }
}

class UserNode extends vscode.TreeItem {
    constructor(
        public user: UserStatus,
        unreadCount: number
    ) {
        super(user.username, vscode.TreeItemCollapsibleState.None);

        // Build description: Activity • Project (Language)
        const parts: string[] = [];
        
        if (user.status === 'Offline') {
            if (user.lastSeen) {
                this.description = `Last seen ${formatLastSeen(user.lastSeen)}`;
            } else {
                this.description = 'Offline';
            }
        } else {
            if (user.activity && user.activity !== 'Hidden' && user.activity !== 'Idle') {
                parts.push(user.activity);
            }
            if (user.project && user.project !== 'Hidden') {
                parts.push(user.project);
            }
            if (user.language && user.language !== 'Hidden') {
                parts.push(`(${user.language})`);
            }
            this.description = parts.join(' • ') || (user.status === 'Away' ? 'Away' : 'Online');
        }

        // Add unread indicator
        if (unreadCount > 0) {
            this.label = `${user.username} 🔵`;
        }

        // Status icon
        this.iconPath = this.getStatusIcon(user.status);
        
        // Tooltip
        this.tooltip = this.buildTooltip(user);
        
        this.contextValue = 'user';
    }

    private getStatusIcon(status: string): vscode.ThemeIcon {
        switch (status) {
            case 'Online':
                return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
            case 'Away':
                return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.yellow'));
            default:
                return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('disabledForeground'));
        }
    }

    private buildTooltip(user: UserStatus): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${user.username}**\n\n`);
        md.appendMarkdown(`Status: ${user.status}\n\n`);
        if (user.activity && user.activity !== 'Hidden') {
            md.appendMarkdown(`Activity: ${user.activity}\n\n`);
        }
        if (user.project && user.project !== 'Hidden') {
            md.appendMarkdown(`Project: ${user.project}\n\n`);
        }
        if (user.language && user.language !== 'Hidden') {
            md.appendMarkdown(`Language: ${user.language}`);
        }
        return md;
    }
}

class DMNode extends vscode.TreeItem {
    constructor(
        public user: UserStatus,
        unreadCount: number
    ) {
        super(user.username, vscode.TreeItemCollapsibleState.None);

        // Show unread count or status
        if (unreadCount > 0) {
            this.description = `${unreadCount} new`;
            this.label = `${user.username} 🔵`;
        } else {
            this.description = user.status === 'Online' ? '🟢' : (user.status === 'Away' ? '🟡' : '');
        }

        // Icon based on status
        if (user.status === 'Online') {
            this.iconPath = new vscode.ThemeIcon('comment', new vscode.ThemeColor('charts.green'));
        } else if (user.status === 'Away') {
            this.iconPath = new vscode.ThemeIcon('comment', new vscode.ThemeColor('charts.yellow'));
        } else {
            this.iconPath = new vscode.ThemeIcon('comment');
        }

        this.contextValue = 'dm';
        this.command = {
            command: 'codecircle.openChat',
            title: 'Open Chat',
            arguments: [{ user }]
        };
    }
}
