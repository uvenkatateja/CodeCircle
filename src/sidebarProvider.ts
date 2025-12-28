import * as vscode from 'vscode';
import { UserStatus, GitHubUser, ConnectionStatus, ChatMessage } from './types';
import { WsClient } from './wsClient';
import { GitHubService } from './githubService';
import { ChatStorage } from './chatStorage';
import { createGuestProfile, buildUserDescription, buildUserTooltip, getStatusIcon } from './utils';

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

    constructor(
        context: vscode.ExtensionContext,
        githubService: GitHubService
    ) {
        this.context = context;
        this.githubService = githubService;
        this.chatStorage = new ChatStorage(context);
        this.profile = { id: 0, login: '', avatar_url: '' };
        this.closeFriends = context.globalState.get<string[]>('closeFriends', []);

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
                // Save incoming message locally
                this.chatStorage.saveIncomingMessage(message);
                if (this.onChatMessageCallback) {
                    this.onChatMessageCallback(message);
                }
            }
        );
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

    /**
     * Connect as GitHub user
     */
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

    /**
     * Connect as guest
     */
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

    /**
     * Disconnect and sign out
     */
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

    /**
     * Reconnect WebSocket
     */
    reconnect() {
        if (this.isAuthenticated) {
            this.wsClient.reconnect();
        }
    }

    /**
     * Update status
     */
    updateStatus(status: Partial<UserStatus>) {
        this.wsClient.updateStatus(status);
    }

    /**
     * Send WebSocket message
     */
    sendMessage(data: any) {
        this.wsClient.send(data);
    }

    /**
     * Add close friend
     */
    addCloseFriend(username: string) {
        if (!this.closeFriends.includes(username)) {
            this.closeFriends.push(username);
            this.context.globalState.update('closeFriends', this.closeFriends);
            this.refresh();
        }
    }

    /**
     * Remove close friend
     */
    removeCloseFriend(username: string) {
        const index = this.closeFriends.indexOf(username);
        if (index !== -1) {
            this.closeFriends.splice(index, 1);
            this.context.globalState.update('closeFriends', this.closeFriends);
            this.refresh();
        }
    }

    /**
     * Refresh tree view
     */
    refresh() {
        this._onDidChangeTreeData.fire();
    }

    // TreeDataProvider implementation
    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeNode): Thenable<TreeNode[]> {
        if (!this.isAuthenticated) {
            return Promise.resolve([]);
        }

        if (element instanceof Category) {
            return Promise.resolve(this.getUsersForCategory(element.label as string));
        }

        // Root level - return categories
        const closeFriendsUsers = this.getCloseFriendsUsers();
        return Promise.resolve([
            new Category('Close Friends', closeFriendsUsers.length)
        ]);
    }

    private getCloseFriendsUsers(): UserStatus[] {
        const closeFriendsLower = this.closeFriends.map(f => f.toLowerCase());
        
        return this.allUsers.filter(u => {
            // Include if pinned
            if (closeFriendsLower.includes(u.username.toLowerCase())) {
                return true;
            }
            // Include manual connections (not in followers/following)
            return this.isManualConnection(u.username);
        });
    }

    private isManualConnection(username: string): boolean {
        if (!this.isGitHubConnected) return true;
        
        const lower = username.toLowerCase();
        const isFollower = this.followers.some(f => f.login.toLowerCase() === lower);
        const isFollowing = this.following.some(f => f.login.toLowerCase() === lower);
        return !isFollower && !isFollowing;
    }

    private getUsersForCategory(category: string): UserNode[] {
        let users: UserStatus[] = [];

        switch (category) {
            case 'Close Friends':
                users = this.getCloseFriendsUsers();
                break;
            case 'Following':
                users = this.getFollowingUsers();
                break;
            case 'Followers':
                users = this.getFollowersUsers();
                break;
            case 'All Users':
                users = this.allUsers.filter(u => u.username !== this.profile.login);
                break;
        }

        const unreadCounts = this.chatStorage.getAllUnreadCounts();
        return users.map(u => new UserNode(
            u,
            this.isManualConnection(u.username),
            unreadCounts.get(u.username.toLowerCase()) || 0
        ));
    }

    private getFollowingUsers(): UserStatus[] {
        const logins = this.following.map(f => f.login.toLowerCase());
        return this.allUsers.filter(u => logins.includes(u.username.toLowerCase()));
    }

    private getFollowersUsers(): UserStatus[] {
        const logins = this.followers.map(f => f.login.toLowerCase());
        return this.allUsers.filter(u => logins.includes(u.username.toLowerCase()));
    }
}

// GitHub Network View Provider
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
            return Promise.resolve(this.getUsersForCategory(element.label as string));
        }

        const followingCount = this.getFollowingUsers().length;
        const followersCount = this.getFollowersUsers().length;
        const allCount = this.sidebarProvider.getAllUsers().length;

        return Promise.resolve([
            new Category('Following', followingCount),
            new Category('Followers', followersCount),
            new Category('All Users', allCount)
        ]);
    }

    private getUsersForCategory(category: string): UserNode[] {
        let users: UserStatus[] = [];
        const profile = this.sidebarProvider.getProfile();

        switch (category) {
            case 'Following':
                users = this.getFollowingUsers();
                break;
            case 'Followers':
                users = this.getFollowersUsers();
                break;
            case 'All Users':
                users = this.sidebarProvider.getAllUsers().filter(u => u.username !== profile.login);
                break;
        }

        return users.map(u => new UserNode(u, false, 0));
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
type TreeNode = Category | UserNode;

class Category extends vscode.TreeItem {
    constructor(label: string, count: number) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${count}`;
        this.contextValue = 'category';
    }
}

class UserNode extends vscode.TreeItem {
    constructor(
        public user: UserStatus,
        isManualConnection: boolean,
        unreadCount: number
    ) {
        super(user.username, vscode.TreeItemCollapsibleState.None);

        this.description = unreadCount > 0 
            ? `🔵 ${buildUserDescription(user)}`
            : buildUserDescription(user);
        this.tooltip = buildUserTooltip(user);
        this.iconPath = getStatusIcon(user.status);
        this.contextValue = isManualConnection ? 'user-manual' : 'user';
    }
}
