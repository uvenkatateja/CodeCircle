// User status from server
export interface UserStatus {
    username: string;
    avatar?: string;
    status: 'Online' | 'Away' | 'Offline';
    activity: string;
    project: string;
    language: string;
    lastSeen?: number;
}

// GitHub user profile
export interface GitHubUser {
    id: number;
    login: string;
    avatar_url: string;
    name?: string;
}

// Chat message (stored locally)
export interface ChatMessage {
    id: string;
    from: string;
    to: string;
    message: string;
    timestamp: number;
    read: boolean;
}

// Connection status
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// User preferences
export interface UserPreferences {
    visibilityMode: 'everyone' | 'followers' | 'following' | 'close-friends' | 'invisible';
    shareProject: boolean;
    shareLanguage: boolean;
    shareActivity: boolean;
}

// WebSocket message types
export interface WsMessage {
    type: string;
    [key: string]: any;
}
