import * as vscode from 'vscode';
import { GitHubService } from './githubService';
import { SidebarProvider, GitHubViewProvider } from './sidebarProvider';
import { StatusProvider } from './statusProvider';
import { ExplorerProvider } from './explorerProvider';
import { ChatWebviewProvider } from './chatWebview';
import { ActivityTracker } from './activityTracker';
import { createGuestProfile } from './utils';
import { ConnectionStatus, UserStatus } from './types';

export async function activate(context: vscode.ExtensionContext) {

    const githubService = new GitHubService();
    
    // Initialize providers
    const sidebarProvider = new SidebarProvider(context, githubService);
    const githubViewProvider = new GitHubViewProvider(sidebarProvider);
    const statusProvider = new StatusProvider();
    const explorerProvider = new ExplorerProvider();

    // Initialize chat webview
    const chatWebviewProvider = new ChatWebviewProvider(
        context.extensionUri,
        sidebarProvider.getWsClient(),
        sidebarProvider.getChatStorage()
    );

    // Connect chat message handler
    sidebarProvider.setOnChatMessage((message) => {
        chatWebviewProvider.onMessageReceived(message);
    });

    // Listen to connection status changes
    sidebarProvider.onConnectionStatusChanged((status: ConnectionStatus) => {
        statusProvider.setStatus(status);
    });

    // Listen to user updates for explorer
    sidebarProvider.onUsersUpdated((users: UserStatus[]) => {
        const closeFriends = context.globalState.get<string[]>('closeFriends', []);
        explorerProvider.updateUsers(users, closeFriends);
        updateStatusBar(users.filter((u: UserStatus) => u.status !== 'Offline').length);
    });

    // Register tree views
    context.subscriptions.push(
        vscode.window.createTreeView('codecircle-friends', {
            treeDataProvider: sidebarProvider,
            showCollapseAll: true
        })
    );

    context.subscriptions.push(
        vscode.window.createTreeView('codecircle-github', {
            treeDataProvider: githubViewProvider,
            showCollapseAll: true
        })
    );

    context.subscriptions.push(
        vscode.window.createTreeView('codecircle-status', {
            treeDataProvider: statusProvider
        })
    );

    // Register explorer view
    const config = vscode.workspace.getConfiguration('codecircle');
    if (config.get('showInExplorer', true)) {
        context.subscriptions.push(
            vscode.window.registerTreeDataProvider('codecircle-explorer', explorerProvider)
        );
    }

    // Register chat webview
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('codecircle-chat', chatWebviewProvider)
    );

    // Status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'workbench.view.extension.codecircle-sidebar';
    statusBarItem.tooltip = 'CodeCircle - Click to view friends';
    context.subscriptions.push(statusBarItem);

    function updateStatusBar(onlineCount: number) {
        if (config.get('showInStatusBar', true) && onlineCount > 0) {
            statusBarItem.text = `$(account) ${onlineCount} online`;
            statusBarItem.show();
        } else {
            statusBarItem.hide();
        }
    }

    // Activity tracker
    let activityTracker: ActivityTracker | null = null;

    function startActivityTracker() {
        if (activityTracker) {
            activityTracker.dispose();
        }
        activityTracker = new ActivityTracker((status) => {
            sidebarProvider.updateStatus(status);
        });
    }

    // Check saved auth state
    const authState = context.globalState.get<'github' | 'guest'>('authState');
    
    if (authState === 'github') {
        try {
            const session = await githubService.authenticate();
            const profile = await githubService.getProfile();
            const followers = await githubService.getFollowers();
            const following = await githubService.getFollowing();
            
            await sidebarProvider.connectGitHub(profile, followers, following);
            chatWebviewProvider.setCurrentUsername(profile.login);
            startActivityTracker();
        } catch (error) {
            await context.globalState.update('authState', undefined);
        }
    } else if (authState === 'guest') {
        const username = context.globalState.get<string>('guestUsername');
        if (username) {
            await sidebarProvider.connectAsGuest(username);
            chatWebviewProvider.setCurrentUsername(username);
            startActivityTracker();
        }
    }

    // ========== COMMANDS ==========

    // Connect GitHub
    context.subscriptions.push(
        vscode.commands.registerCommand('codecircle.connectGitHub', async () => {
            try {
                vscode.window.showInformationMessage('Connecting to GitHub...');
                
                await githubService.authenticate();
                const profile = await githubService.getProfile();
                const followers = await githubService.getFollowers();
                const following = await githubService.getFollowing();
                
                await sidebarProvider.connectGitHub(profile, followers, following);
                chatWebviewProvider.setCurrentUsername(profile.login);
                startActivityTracker();
                
                vscode.window.showInformationMessage(`Connected as ${profile.login}`);
            } catch (error) {
                vscode.window.showErrorMessage('Failed to connect to GitHub');
            }
        })
    );

    // Continue as Guest
    context.subscriptions.push(
        vscode.commands.registerCommand('codecircle.continueAsGuest', async () => {
            const username = await vscode.window.showInputBox({
                prompt: 'Enter a username',
                placeHolder: 'MyUsername',
                validateInput: (value: string) => {
                    if (!value || value.length < 3) return 'Username must be at least 3 characters';
                    if (!/^[a-zA-Z0-9_-]+$/.test(value)) return 'Only letters, numbers, hyphens, underscores';
                    return null;
                }
            });

            if (username) {
                await sidebarProvider.connectAsGuest(username);
                chatWebviewProvider.setCurrentUsername(username);
                startActivityTracker();
                vscode.window.showInformationMessage(`Connected as ${username}`);
            }
        })
    );

    // Refresh
    context.subscriptions.push(
        vscode.commands.registerCommand('codecircle.refresh', () => {
            sidebarProvider.reconnect();
            sidebarProvider.refresh();
            githubViewProvider.refresh();
        })
    );

    // Create Invite
    context.subscriptions.push(
        vscode.commands.registerCommand('codecircle.createInvite', () => {
            sidebarProvider.sendMessage({ type: 'createInvite' });
        })
    );

    // Accept Invite
    context.subscriptions.push(
        vscode.commands.registerCommand('codecircle.acceptInvite', async () => {
            const code = await vscode.window.showInputBox({
                prompt: 'Enter invite code',
                placeHolder: 'ABC123',
                validateInput: (value: string) => {
                    if (!value || value.length !== 6) return 'Code must be 6 characters';
                    return null;
                }
            });

            if (code) {
                sidebarProvider.sendMessage({ 
                    type: 'acceptInvite', 
                    code: code.toUpperCase() 
                });
            }
        })
    );

    // Pin Friend
    context.subscriptions.push(
        vscode.commands.registerCommand('codecircle.pinFriend', (item: any) => {
            if (item?.user?.username) {
                sidebarProvider.addCloseFriend(item.user.username);
                vscode.window.showInformationMessage(`Pinned ${item.user.username}`);
            }
        })
    );

    // Unpin Friend
    context.subscriptions.push(
        vscode.commands.registerCommand('codecircle.unpinFriend', (item: any) => {
            if (item?.user?.username) {
                sidebarProvider.removeCloseFriend(item.user.username);
                vscode.window.showInformationMessage(`Unpinned ${item.user.username}`);
            }
        })
    );

    // Open Chat
    context.subscriptions.push(
        vscode.commands.registerCommand('codecircle.openChat', (item: any) => {
            const username = item?.user?.username || (typeof item === 'string' ? item : null);
            if (username) {
                chatWebviewProvider.openChat(username);
            }
        })
    );

    // Open Settings
    context.subscriptions.push(
        vscode.commands.registerCommand('codecircle.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'codecircle');
        })
    );

    // Sign Out
    context.subscriptions.push(
        vscode.commands.registerCommand('codecircle.signOut', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Sign out of CodeCircle?',
                'Sign Out',
                'Cancel'
            );

            if (confirm === 'Sign Out') {
                await sidebarProvider.signOut();
                if (activityTracker) {
                    activityTracker.dispose();
                    activityTracker = null;
                }
                statusBarItem.hide();
                vscode.window.showInformationMessage('Signed out');
            }
        })
    );

    // Copy Username
    context.subscriptions.push(
        vscode.commands.registerCommand('codecircle.copyUsername', () => {
            const profile = sidebarProvider.getProfile();
            if (profile.login) {
                vscode.env.clipboard.writeText(profile.login);
                vscode.window.showInformationMessage(`Copied: ${profile.login}`);
            }
        })
    );

    // Watch config changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
            if (e.affectsConfiguration('codecircle.visibilityMode')) {
                const mode = config.get('visibilityMode', 'everyone');
                sidebarProvider.sendMessage({
                    type: 'updatePreferences',
                    preferences: { visibilityMode: mode }
                });
            }
        })
    );

}

export function deactivate() {}
