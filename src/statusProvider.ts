import * as vscode from 'vscode';
import { ConnectionStatus } from './types';

/**
 * Connection Status Tree View Provider
 */
export class StatusProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private status: ConnectionStatus = 'disconnected';

    setStatus(status: ConnectionStatus) {
        this.status = status;
        this._onDidChangeTreeData.fire();
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(): Thenable<vscode.TreeItem[]> {
        const item = new vscode.TreeItem(
            this.getLabel(),
            vscode.TreeItemCollapsibleState.None
        );
        item.iconPath = this.getIcon();
        item.tooltip = this.getTooltip();
        return Promise.resolve([item]);
    }

    private getLabel(): string {
        switch (this.status) {
            case 'connected': return 'Connected';
            case 'connecting': return 'Connecting...';
            case 'error': return 'Connection Error';
            default: return 'Disconnected';
        }
    }

    private getIcon(): vscode.ThemeIcon {
        switch (this.status) {
            case 'connected':
                return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
            case 'connecting':
                return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
            case 'error':
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
            default:
                return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('disabledForeground'));
        }
    }

    private getTooltip(): string {
        switch (this.status) {
            case 'connected': return 'Connected to CodeCircle server';
            case 'connecting': return 'Connecting to server...';
            case 'error': return 'Failed to connect. Click refresh to retry.';
            default: return 'Not connected';
        }
    }
}
