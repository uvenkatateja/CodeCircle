import * as vscode from 'vscode';
import { UserStatus } from './types';
import { buildUserDescription, buildUserTooltip, getStatusIcon } from './utils';

/**
 * Explorer sidebar widget showing online friends
 */
export class ExplorerProvider implements vscode.TreeDataProvider<ExplorerUserItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ExplorerUserItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private onlineUsers: UserStatus[] = [];
    private pinnedFriends: string[] = [];

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    updateUsers(users: UserStatus[], pinnedFriends: string[]) {
        // Only show online users who are pinned
        this.pinnedFriends = pinnedFriends.map(f => f.toLowerCase());
        this.onlineUsers = users.filter(u => 
            u.status !== 'Offline' && 
            this.pinnedFriends.includes(u.username.toLowerCase())
        );
        this.refresh();
    }

    getTreeItem(element: ExplorerUserItem): vscode.TreeItem {
        return element;
    }

    getChildren(): Thenable<ExplorerUserItem[]> {
        if (this.onlineUsers.length === 0) {
            return Promise.resolve([]);
        }

        // Sort: Online first, then by username
        const sorted = [...this.onlineUsers].sort((a, b) => {
            if (a.status === 'Online' && b.status !== 'Online') return -1;
            if (a.status !== 'Online' && b.status === 'Online') return 1;
            return a.username.localeCompare(b.username);
        });

        return Promise.resolve(sorted.map(u => new ExplorerUserItem(u)));
    }
}

class ExplorerUserItem extends vscode.TreeItem {
    constructor(public user: UserStatus) {
        super(user.username, vscode.TreeItemCollapsibleState.None);
        this.description = buildUserDescription(user);
        this.tooltip = buildUserTooltip(user);
        this.iconPath = getStatusIcon(user.status);
        this.contextValue = 'explorerUser';
    }
}
