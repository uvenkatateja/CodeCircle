import { Octokit } from '@octokit/rest';
import * as queries from './db/queries';

const PORT = parseInt(process.env.PORT || '8080');

// Declare Bun global for TypeScript
declare const Bun: any;

// Client data structure
interface ClientData {
    username: string;
    githubId?: number;
    avatar?: string;
    followers: number[];
    following: number[];
    status: string;
    activity: string;
    project: string;
    language: string;
    preferences?: {
        visibilityMode: string;
        shareProject: boolean;
        shareLanguage: boolean;
        shareActivity: boolean;
    };
    isAlive: boolean;
    lastHeartbeat: number;
}

// WebSocket type for Bun
type BunWebSocket = {
    send: (data: string) => void;
    close: () => void;
    readyState: number;
};

// Connected clients
const clients = new Map<BunWebSocket, ClientData>();

// Validate GitHub token
async function validateGitHubToken(token: string) {
    try {
        const octokit = new Octokit({ auth: token });
        const { data } = await octokit.users.getAuthenticated();
        
        const [followersRes, followingRes] = await Promise.all([
            octokit.users.listFollowersForAuthenticatedUser({ per_page: 100 }),
            octokit.users.listFollowedByAuthenticatedUser({ per_page: 100 })
        ]);
        
        return {
            id: data.id,
            login: data.login,
            avatar_url: data.avatar_url,
            followers: followersRes.data.map((u: { id: number }) => u.id),
            following: followingRes.data.map((u: { id: number }) => u.id)
        };
    } catch (error) {
        console.error('GitHub validation failed:', error);
        return null;
    }
}

// Check if viewer can see target based on privacy settings
function canUserSee(viewerGithubId: number | undefined, target: ClientData): boolean {
    if (!target.preferences || !target.githubId) return true;
    
    const mode = target.preferences.visibilityMode;
    
    switch (mode) {
        case 'invisible': return false;
        case 'everyone': return true;
        case 'followers':
            return viewerGithubId !== undefined && target.followers.includes(viewerGithubId);
        case 'following':
            return viewerGithubId !== undefined && target.following.includes(viewerGithubId);
        default: return true;
    }
}

// Filter user data based on preferences
function filterUserData(client: ClientData) {
    const data: Record<string, string | undefined> = {
        username: client.username,
        avatar: client.avatar,
        status: client.status,
        activity: client.activity,
        project: client.project,
        language: client.language
    };
    
    if (client.preferences) {
        if (!client.preferences.shareProject) data.project = '';
        if (!client.preferences.shareLanguage) data.language = '';
        if (!client.preferences.shareActivity) data.activity = 'Hidden';
    }
    
    return data;
}

// Broadcast debouncing
let broadcastTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleBroadcast() {
    if (broadcastTimer) return;
    
    broadcastTimer = setTimeout(() => {
        broadcastUpdate();
        broadcastTimer = null;
    }, 2000);
}

// Broadcast user list to all clients
async function broadcastUpdate() {
    // Aggregate sessions per user (handle multiple windows)
    const userSessions = new Map<string, ClientData[]>();
    
    for (const clientData of clients.values()) {
        const sessions = userSessions.get(clientData.username) || [];
        sessions.push(clientData);
        userSessions.set(clientData.username, sessions);
    }
    
    // Pick most active session per user
    const aggregatedUsers = new Map<string, ClientData>();
    const activityPriority: Record<string, number> = {
        'Debugging': 4, 'Coding': 3, 'Reading': 2, 'Idle': 1, 'Hidden': 0
    };
    
    for (const [username, sessions] of userSessions) {
        const mostActive = sessions.reduce((prev, curr) => {
            const prevP = activityPriority[prev.activity] || 0;
            const currP = activityPriority[curr.activity] || 0;
            return currP > prevP ? curr : prev;
        });
        aggregatedUsers.set(username, mostActive);
    }
    
    // Send to each client
    for (const [ws, receiverData] of clients) {
        if (ws.readyState !== 1) continue; // Not OPEN
        
        const visibleUsers: Record<string, string | undefined>[] = [];
        
        for (const clientData of aggregatedUsers.values()) {
            if (clientData.username === receiverData.username) continue;
            
            // Check manual connection
            const resolvedReceiver = await queries.resolveUsername(receiverData.username);
            const resolvedClient = await queries.resolveUsername(clientData.username);
            const isManual = await queries.isManuallyConnected(resolvedReceiver, resolvedClient);
            
            if (isManual || canUserSee(receiverData.githubId, clientData)) {
                visibleUsers.push(filterUserData(clientData));
            }
        }
        
        ws.send(JSON.stringify({ type: 'userList', users: visibleUsers }));
    }
}

// Bun WebSocket server
Bun.serve({
    port: PORT,
    
    fetch(req: Request, server: { upgrade: (req: Request) => boolean }) {
        // Upgrade to WebSocket
        if (server.upgrade(req)) {
            return;
        }
        return new Response('CodeCircle WebSocket Server', { status: 200 });
    },
    
    websocket: {
        open(ws: BunWebSocket) {
            console.log('Client connected');
        },
        
        async message(ws: BunWebSocket, message: string | ArrayBuffer) {
            try {
                const data = JSON.parse(message.toString());
                
                // Heartbeat
                if (data.type === 'hb') {
                    const client = clients.get(ws);
                    if (client) {
                        client.isAlive = true;
                        client.lastHeartbeat = Date.now();
                    }
                    ws.send(JSON.stringify({ type: 'hb', ts: data.ts, ack: true }));
                    return;
                }
                
                // Login
                if (data.type === 'login') {
                    let clientData: ClientData;
                    
                    if (data.token) {
                        const github = await validateGitHubToken(data.token);
                        
                        if (github) {
                            // Save to database
                            const user = await queries.upsertUser(github.id, github.login, github.avatar_url);
                            
                            // Save relationships
                            await queries.upsertRelationships(user.id, [
                                ...github.followers.map((id: number) => ({ githubId: id, type: 'follower' as const })),
                                ...github.following.map((id: number) => ({ githubId: id, type: 'following' as const }))
                            ]);
                            
                            const prefs = await queries.getPreferences(user.id);
                            
                            clientData = {
                                username: github.login,
                                githubId: github.id,
                                avatar: github.avatar_url,
                                followers: github.followers,
                                following: github.following,
                                status: 'Online',
                                activity: 'Idle',
                                project: '',
                                language: '',
                                preferences: prefs,
                                isAlive: true,
                                lastHeartbeat: Date.now()
                            };
                            
                            console.log(`GitHub user logged in: ${github.login}`);
                        } else {
                            // Token invalid, treat as guest
                            clientData = {
                                username: data.username,
                                followers: [],
                                following: [],
                                status: 'Online',
                                activity: 'Idle',
                                project: '',
                                language: '',
                                isAlive: true,
                                lastHeartbeat: Date.now()
                            };
                        }
                    } else {
                        // Guest login
                        clientData = {
                            username: data.username,
                            followers: [],
                            following: [],
                            status: 'Online',
                            activity: 'Idle',
                            project: '',
                            language: '',
                            isAlive: true,
                            lastHeartbeat: Date.now()
                        };
                        console.log(`Guest logged in: ${data.username}`);
                    }
                    
                    clients.set(ws, clientData);
                    scheduleBroadcast();
                    return;
                }
                
                const clientData = clients.get(ws);
                if (!clientData) return;
                
                // Status update
                if (data.type === 'statusUpdate') {
                    if (data.status) clientData.status = data.status;
                    if (data.activity) clientData.activity = data.activity;
                    if (data.project !== undefined) clientData.project = data.project;
                    if (data.language !== undefined) clientData.language = data.language;
                    scheduleBroadcast();
                    return;
                }
                
                // Create invite
                if (data.type === 'createInvite') {
                    const code = await queries.createInviteCode(clientData.username, 48);
                    ws.send(JSON.stringify({
                        type: 'inviteCreated',
                        code,
                        expiresIn: '48 hours'
                    }));
                    console.log(`Invite created: ${code} by ${clientData.username}`);
                    return;
                }
                
                // Accept invite
                if (data.type === 'acceptInvite' && data.code) {
                    const result = await queries.acceptInviteCode(data.code, clientData.username);
                    
                    if (result.success) {
                        ws.send(JSON.stringify({
                            type: 'inviteAccepted',
                            success: true,
                            friendUsername: result.creator
                        }));
                        
                        // Notify creator if online
                        for (const [otherWs, otherClient] of clients) {
                            if (otherClient.username === result.creator) {
                                otherWs.send(JSON.stringify({
                                    type: 'friendJoined',
                                    user: { username: clientData.username, avatar: clientData.avatar }
                                }));
                            }
                        }
                        
                        scheduleBroadcast();
                    } else {
                        ws.send(JSON.stringify({
                            type: 'inviteAccepted',
                            success: false,
                            error: result.error
                        }));
                    }
                    return;
                }
                
                // Update preferences
                if (data.type === 'updatePreferences' && clientData.githubId) {
                    const user = await queries.getUserByGithubId(clientData.githubId);
                    if (user) {
                        await queries.updatePreferences(user.id, data.preferences);
                        clientData.preferences = { ...clientData.preferences, ...data.preferences };
                        scheduleBroadcast();
                    }
                    return;
                }
                
                // Chat message (relay only, no storage)
                if (data.type === 'chatMessage' && data.to && data.message) {
                    const message = data.message.substring(0, 500);
                    
                    // Find recipient
                    for (const [recipientWs, recipientData] of clients) {
                        if (recipientData.username.toLowerCase() === data.to.toLowerCase()) {
                            recipientWs.send(JSON.stringify({
                                type: 'chatMessage',
                                from: clientData.username,
                                to: data.to,
                                message,
                                timestamp: Date.now()
                            }));
                        }
                    }
                    return;
                }
                
                // Create alias
                if (data.type === 'createAlias' && data.githubUsername && data.guestUsername && data.githubId) {
                    await queries.createAlias(data.githubUsername, data.guestUsername, data.githubId);
                    console.log(`Alias created: ${data.guestUsername} -> ${data.githubUsername}`);
                    return;
                }
                
            } catch (error) {
                console.error('Error handling message:', error);
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
            }
        },
        
        async close(ws: BunWebSocket) {
            const clientData = clients.get(ws);
            if (clientData) {
                console.log(`User disconnected: ${clientData.username}`);
                
                if (clientData.githubId) {
                    await queries.updateLastSeen(clientData.githubId);
                }
            }
            clients.delete(ws);
            scheduleBroadcast();
        }
    }
});

// Heartbeat interval
setInterval(() => {
    const now = Date.now();
    
    for (const [ws, clientData] of clients) {
        if (!clientData.isAlive) {
            console.log(`Heartbeat timeout: ${clientData.username}`);
            ws.close();
            continue;
        }
        
        clientData.isAlive = false;
        ws.send(JSON.stringify({ type: 'hb', ts: now }));
    }
}, 30000);

console.log(`CodeCircle server running on port ${PORT}`);
