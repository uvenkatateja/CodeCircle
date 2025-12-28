import WebSocket from 'ws';
import * as vscode from 'vscode';
import { UserStatus, ConnectionStatus, ChatMessage, WsMessage } from './types';
import { DEFAULT_SERVER, generateId } from './utils';

export class WsClient {
    private ws: WebSocket | null = null;
    private username: string = '';
    private token: string | undefined;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private isIntentionallyClosed = false;
    private lastSentStatus: string = '';
    private _connectionStatus: ConnectionStatus = 'disconnected';

    // Callbacks
    private onUserListUpdate: (users: UserStatus[]) => void;
    private onConnectionStatusChange: (status: ConnectionStatus) => void;
    private onChatMessage: (message: ChatMessage) => void;

    constructor(
        onUserListUpdate: (users: UserStatus[]) => void,
        onConnectionStatusChange: (status: ConnectionStatus) => void,
        onChatMessage: (message: ChatMessage) => void
    ) {
        this.onUserListUpdate = onUserListUpdate;
        this.onConnectionStatusChange = onConnectionStatusChange;
        this.onChatMessage = onChatMessage;
    }

    get connectionStatus(): ConnectionStatus {
        return this._connectionStatus;
    }

    private setConnectionStatus(status: ConnectionStatus) {
        this._connectionStatus = status;
        this.onConnectionStatusChange(status);
    }

    /**
     * Connect to WebSocket server
     */
    connect(username: string, token?: string) {
        this.username = username;
        this.token = token;
        this.isIntentionallyClosed = false;
        this.reconnectAttempts = 0;
        this.attemptConnection();
    }

    /**
     * Reconnect to server
     */
    reconnect() {
        this.isIntentionallyClosed = false;
        this.reconnectAttempts = 0;

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        this.attemptConnection();
    }

    private attemptConnection() {
        if (!this.username) {
            console.warn('Cannot connect without username');
            this.setConnectionStatus('error');
            return;
        }

        this.setConnectionStatus('connecting');

        try {
            // Get server URL from settings or use default
            const config = vscode.workspace.getConfiguration('codecircle');
            const customUrl = config.get<string>('serverUrl');
            const serverUrl = customUrl || DEFAULT_SERVER;

            console.log(`Connecting to: ${serverUrl}`);
            this.ws = new WebSocket(serverUrl);

            this.ws.on('open', () => {
                console.log('WebSocket connected');
                this.reconnectAttempts = 0;
                this.setConnectionStatus('connected');

                // Send login message
                const config = vscode.workspace.getConfiguration('codecircle');
                this.send({
                    type: 'login',
                    username: this.username,
                    token: this.token,
                    visibilityMode: config.get('visibilityMode', 'everyone')
                });
            });

            this.ws.on('message', (data) => {
                try {
                    const message: WsMessage = JSON.parse(data.toString());
                    this.handleMessage(message);
                } catch (e) {
                    console.error('Error parsing message:', e);
                }
            });

            this.ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.setConnectionStatus('error');
            });

            this.ws.on('close', () => {
                console.log('WebSocket disconnected');
                this.setConnectionStatus('disconnected');

                if (!this.isIntentionallyClosed) {
                    this.scheduleReconnect();
                }
            });

        } catch (error) {
            console.error('Failed to connect:', error);
            this.setConnectionStatus('error');
            this.scheduleReconnect();
        }
    }

    private handleMessage(message: WsMessage) {
        switch (message.type) {
            case 'userList':
                this.onUserListUpdate(message.users);
                break;

            case 'inviteCreated':
                vscode.window.showInformationMessage(
                    `Invite Code: ${message.code} (expires in ${message.expiresIn})`,
                    'Copy Code'
                ).then(selection => {
                    if (selection === 'Copy Code') {
                        vscode.env.clipboard.writeText(message.code);
                        vscode.window.showInformationMessage('Code copied!');
                    }
                });
                break;

            case 'inviteAccepted':
                if (message.success) {
                    vscode.window.showInformationMessage(`Connected with ${message.friendUsername}!`);
                } else {
                    vscode.window.showErrorMessage(message.error || 'Failed to accept invite');
                }
                break;

            case 'chatMessage':
                this.onChatMessage({
                    id: generateId(),
                    from: message.from,
                    to: message.to,
                    message: message.message,
                    timestamp: message.timestamp || Date.now(),
                    read: false
                });
                break;

            case 'error':
                vscode.window.showErrorMessage(`CodeCircle: ${message.message}`);
                break;

            case 'hb':
                // Heartbeat - respond
                this.send({ type: 'hb', ts: message.ts });
                break;
        }
    }

    private scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            this.setConnectionStatus('error');
            return;
        }

        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60000);
        this.reconnectAttempts++;

        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        this.reconnectTimeout = setTimeout(() => {
            this.attemptConnection();
        }, delay);
    }

    /**
     * Send message to server
     */
    send(data: WsMessage) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    /**
     * Update status
     */
    updateStatus(status: Partial<UserStatus>) {
        const statusString = JSON.stringify(status);
        if (statusString === this.lastSentStatus) return;

        this.lastSentStatus = statusString;
        this.send({
            type: 'statusUpdate',
            ...status
        });
    }

    /**
     * Send chat message
     */
    sendChatMessage(to: string, message: string) {
        this.send({
            type: 'chatMessage',
            to,
            message
        });
    }

    /**
     * Disconnect
     */
    disconnect() {
        this.isIntentionallyClosed = true;

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.setConnectionStatus('disconnected');
    }
}
