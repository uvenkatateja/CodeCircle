import * as vscode from 'vscode';
import { ChatMessage } from './types';
import { generateId } from './utils';

/**
 * Local chat storage using VS Code's globalState
 * Chat messages are stored on the client, not the server
 */
export class ChatStorage {
    private context: vscode.ExtensionContext;
    private readonly MAX_MESSAGES_PER_USER = 100;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Save a message to local storage
     */
    saveMessage(withUser: string, message: ChatMessage): void {
        const key = this.getKey(withUser);
        const history = this.getHistory(withUser);
        
        history.push(message);

        // Keep only last N messages
        if (history.length > this.MAX_MESSAGES_PER_USER) {
            history.shift();
        }

        this.context.globalState.update(key, history);
    }

    /**
     * Create and save an outgoing message
     */
    createOutgoingMessage(from: string, to: string, text: string): ChatMessage {
        const message: ChatMessage = {
            id: generateId(),
            from,
            to,
            message: text,
            timestamp: Date.now(),
            read: true // Own messages are always read
        };

        this.saveMessage(to, message);
        return message;
    }

    /**
     * Save an incoming message
     */
    saveIncomingMessage(message: ChatMessage): void {
        this.saveMessage(message.from, message);
    }

    /**
     * Get chat history with a user
     */
    getHistory(withUser: string): ChatMessage[] {
        const key = this.getKey(withUser);
        return this.context.globalState.get<ChatMessage[]>(key, []);
    }

    /**
     * Mark all messages from a user as read
     */
    markAsRead(fromUser: string): void {
        const key = this.getKey(fromUser);
        const history = this.getHistory(fromUser);
        
        let changed = false;
        for (const msg of history) {
            if (msg.from === fromUser && !msg.read) {
                msg.read = true;
                changed = true;
            }
        }

        if (changed) {
            this.context.globalState.update(key, history);
        }
    }

    /**
     * Get unread count from a user
     */
    getUnreadCount(fromUser: string): number {
        const history = this.getHistory(fromUser);
        return history.filter(m => m.from === fromUser && !m.read).length;
    }

    /**
     * Get all unread counts
     */
    getAllUnreadCounts(): Map<string, number> {
        const counts = new Map<string, number>();
        const keys = this.context.globalState.keys();

        for (const key of keys) {
            if (key.startsWith('chat_')) {
                const username = key.replace('chat_', '');
                const count = this.getUnreadCount(username);
                if (count > 0) {
                    counts.set(username, count);
                }
            }
        }

        return counts;
    }

    /**
     * Clear chat history with a user
     */
    clearHistory(withUser: string): void {
        const key = this.getKey(withUser);
        this.context.globalState.update(key, []);
    }

    /**
     * Clear all chat history
     */
    clearAll(): void {
        const keys = this.context.globalState.keys();
        for (const key of keys) {
            if (key.startsWith('chat_')) {
                this.context.globalState.update(key, undefined);
            }
        }
    }

    private getKey(username: string): string {
        return `chat_${username.toLowerCase()}`;
    }
}
