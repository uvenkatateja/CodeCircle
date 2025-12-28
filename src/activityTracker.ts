import * as vscode from 'vscode';
import { UserStatus } from './types';

export class ActivityTracker {
    private statusCallback: (status: Partial<UserStatus>) => void;
    private idleTimer: NodeJS.Timeout | null = null;
    private idleTimeout = 60000; // 1 minute
    private lastUpdateTime = 0;
    private throttleMs = 5000; // 5 seconds
    private lastSentStatus: string = '';
    private currentActivity: string = 'Idle';
    private isWindowFocused: boolean = true;
    private focusLostTimer: NodeJS.Timeout | null = null;
    private disposables: vscode.Disposable[] = [];

    constructor(statusCallback: (status: Partial<UserStatus>) => void) {
        this.statusCallback = statusCallback;
        this.initialize();
    }

    private initialize() {
        this.isWindowFocused = vscode.window.state.focused;

        // Window focus changes
        this.disposables.push(
            vscode.window.onDidChangeWindowState((state) => {
                const wasFocused = this.isWindowFocused;
                this.isWindowFocused = state.focused;

                if (this.isWindowFocused && !wasFocused) {
                    // Regained focus
                    if (this.focusLostTimer) {
                        clearTimeout(this.focusLostTimer);
                        this.focusLostTimer = null;
                    }
                    this.updateActivity(this.currentActivity, true);
                } else if (!this.isWindowFocused && wasFocused) {
                    // Lost focus - delay before marking idle
                    this.focusLostTimer = setTimeout(() => {
                        if (!this.isWindowFocused) {
                            this.currentActivity = 'Idle';
                            this.statusCallback({
                                activity: 'Idle',
                                status: 'Away'
                            });
                        }
                    }, 5000);
                }
            })
        );

        // Editor changes
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => {
                if (this.isWindowFocused) {
                    this.updateActivity();
                }
            })
        );

        // Typing detection
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument((e) => {
                if (e.document.uri.scheme === 'file' && this.isWindowFocused) {
                    this.currentActivity = 'Coding';
                    this.resetIdleTimer();
                    this.updateActivity('Coding');
                }
            })
        );

        // Debug session start
        this.disposables.push(
            vscode.debug.onDidStartDebugSession(() => {
                if (this.isWindowFocused) {
                    this.currentActivity = 'Debugging';
                    this.updateActivity('Debugging', true);
                }
            })
        );

        // Debug session end
        this.disposables.push(
            vscode.debug.onDidTerminateDebugSession(() => {
                if (this.isWindowFocused) {
                    this.currentActivity = 'Reading';
                    this.updateActivity();
                }
            })
        );

        // Initial update
        if (this.isWindowFocused) {
            this.updateActivity();
        }
    }

    private updateActivity(activityOverride?: string, forceImmediate: boolean = false) {
        const now = Date.now();
        const isHighPriority = activityOverride === 'Coding' || activityOverride === 'Debugging' || forceImmediate;

        // Throttle non-priority updates
        if (!isHighPriority && now - this.lastUpdateTime < this.throttleMs) {
            return;
        }

        this.lastUpdateTime = now;

        if (!this.isWindowFocused) return;

        const config = vscode.workspace.getConfiguration('codecircle');
        const shareProject = config.get<boolean>('shareProject', true);
        const shareLanguage = config.get<boolean>('shareLanguage', true);
        const shareActivity = config.get<boolean>('shareActivity', true);

        const editor = vscode.window.activeTextEditor;
        let newStatus: Partial<UserStatus> = {};

        if (editor) {
            const project = shareProject ? (vscode.workspace.name || 'Unknown') : 'Hidden';
            const language = shareLanguage ? editor.document.languageId : 'Hidden';
            let activity = activityOverride || this.currentActivity;
            if (!activityOverride && this.currentActivity === 'Idle') {
                activity = 'Reading';
            }

            newStatus = {
                project,
                language,
                activity: shareActivity ? activity : 'Hidden',
                status: 'Online'
            };
        } else {
            newStatus = {
                activity: shareActivity ? 'Idle' : 'Hidden',
                status: 'Online',
                project: '',
                language: ''
            };
            this.currentActivity = 'Idle';
        }

        // Only send if changed
        const statusString = JSON.stringify(newStatus);
        if (statusString !== this.lastSentStatus) {
            this.lastSentStatus = statusString;
            this.statusCallback(newStatus);
        }

        this.resetIdleTimer();
    }

    private resetIdleTimer() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }

        if (this.isWindowFocused) {
            this.idleTimer = setTimeout(() => {
                this.currentActivity = 'Idle';
                this.statusCallback({
                    activity: 'Idle',
                    status: 'Away'
                });
            }, this.idleTimeout);
        }
    }

    dispose() {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        if (this.focusLostTimer) clearTimeout(this.focusLostTimer);
        this.disposables.forEach(d => d.dispose());
    }
}
