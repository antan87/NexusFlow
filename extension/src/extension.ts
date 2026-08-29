import * as vscode from 'vscode';
import * as http from 'http';
import * as child_process from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

let serverProcess: child_process.ChildProcess | null = null;
let myStatusBarItem: vscode.StatusBarItem | null = null;

// The extension owns its backend, so it pins the port and starts the server
// with --strict-port (below) rather than chasing an auto-incremented one.
const SERVER_PORT = 3000;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

/**
 * Resolves how to invoke the NexusFlow CLI. Prefers the bundled build (present
 * when running from the source tree), and falls back to a globally installed
 * `nexusflow` binary on PATH — so the packaged, installed extension still works
 * instead of pointing at a non-existent sibling `dist/`.
 */
function resolveCli(context: vscode.ExtensionContext): { command: string; prefixArgs: string[] } {
    const bundled = path.join(context.extensionPath, '..', 'dist', 'index.js');
    if (fs.existsSync(bundled)) {
        return { command: 'node', prefixArgs: [bundled] };
    }
    return { command: process.platform === 'win32' ? 'ctxspace.cmd' : 'ctxspace', prefixArgs: [] };
}

function checkServerRunning(): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.get(`${SERVER_URL}/api/config`, (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => {
            resolve(false);
        });
        req.setTimeout(1000, () => {
            req.destroy();
            resolve(false);
        });
    });
}

async function startHonoServer(context: vscode.ExtensionContext) {
    const isRunning = await checkServerRunning();
    if (isRunning) {
        console.log('Hono server is already running.');
        return;
    }

    console.log('Starting Hono server...');
    const { command, prefixArgs } = resolveCli(context);

    serverProcess = child_process.spawn(
        command,
        [...prefixArgs, 'ui', '--server-only', '--strict-port', '--port', String(SERVER_PORT)],
        {
            cwd: path.join(context.extensionPath, '..'),
            env: { ...process.env },
            detached: false,
            shell: process.platform === 'win32',
        }
    );

    serverProcess.stdout?.on('data', (data) => {
        console.log(`[Hono Server]: ${data}`);
    });

    serverProcess.stderr?.on('data', (data) => {
        console.error(`[Hono Server Error]: ${data}`);
    });

    serverProcess.on('close', (code) => {
        console.log(`Hono server exited with code ${code}`);
        serverProcess = null;
    });
}

export function activate(context: vscode.ExtensionContext) {
    console.log('ContextSpace extension is activating...');
    
    // Start Hono server in background if not running
    startHonoServer(context);

    // Scope keybindings to workspaces where contextspace.json or nexusflow.json exists
    vscode.commands.executeCommand('setContext', 'contextspace.workspaceActive', true);
    vscode.commands.executeCommand('setContext', 'nexusflow.workspaceActive', true);

    // Initialize Status Bar Item
    myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    myStatusBarItem.command = 'contextspace.openTui';
    context.subscriptions.push(myStatusBarItem);
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(updateStatusBarItem));
    updateStatusBarItem();

    // Register Webview Provider
    const provider = new ContextSpaceSidebarProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ContextSpaceSidebarProvider.viewType,
            provider
        )
    );
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'nexusflow.dashboardView',
            provider
        )
    );

    // Register MCP Server Definition Provider if supported by the VS Code version
    if (typeof (vscode as any).lm?.registerMcpServerDefinitionProvider === 'function') {
        const mcpProvider = {
            provideMcpServerDefinitions: async () => {
                const { command, prefixArgs } = resolveCli(context);
                const workspaceFolders = vscode.workspace.workspaceFolders;
                const args = [...prefixArgs, 'mcp', 'run'];
                if (workspaceFolders && workspaceFolders.length > 0) {
                    args.push(workspaceFolders[0].uri.fsPath);
                }

                return [
                    new (vscode as any).McpStdioServerDefinition({
                        label: 'ContextSpace MCP Server',
                        command,
                        args: args
                    })
                ];
            }
        };
        context.subscriptions.push(
            (vscode as any).lm.registerMcpServerDefinitionProvider('contextspace-mcp', mcpProvider)
        );
        context.subscriptions.push(
            (vscode as any).lm.registerMcpServerDefinitionProvider('nexusflow-mcp', mcpProvider)
        );
        console.log('ContextSpace MCP Server Definition Provider registered successfully.');
    } else {
        console.log('registerMcpServerDefinitionProvider is not supported on this VS Code version.');
    }

    // Register Focus Dashboard Command
    const openDashboardHandler = () => {
        vscode.commands.executeCommand('workbench.view.extension.contextspace-sidebar');
    };
    context.subscriptions.push(vscode.commands.registerCommand('contextspace.openDashboard', openDashboardHandler));
    context.subscriptions.push(vscode.commands.registerCommand('nexusflow.openDashboard', openDashboardHandler));

    // Register Open Browser Dashboard Command
    const openBrowserHandler = () => {
        vscode.env.openExternal(vscode.Uri.parse(SERVER_URL));
    };
    context.subscriptions.push(vscode.commands.registerCommand('contextspace.openBrowserDashboard', openBrowserHandler));
    context.subscriptions.push(vscode.commands.registerCommand('nexusflow.openBrowserDashboard', openBrowserHandler));

    // Register Open TUI Command
    const openTuiHandler = () => {
        runContextSpaceCommand(context, 'tui');
    };
    context.subscriptions.push(vscode.commands.registerCommand('contextspace.openTui', openTuiHandler));
    context.subscriptions.push(vscode.commands.registerCommand('nexusflow.openTui', openTuiHandler));

    // Register Create Workspace Command
    const createWsHandler = () => {
        runContextSpaceCommand(context, 'create');
    };
    context.subscriptions.push(vscode.commands.registerCommand('contextspace.createWorkspace', createWsHandler));
    context.subscriptions.push(vscode.commands.registerCommand('nexusflow.createWorkspace', createWsHandler));

    // Register Sync Workspace Command
    const syncWsHandler = () => {
        runContextSpaceCommand(context, 'sync');
    };
    context.subscriptions.push(vscode.commands.registerCommand('contextspace.syncWorkspace', syncWsHandler));
    context.subscriptions.push(vscode.commands.registerCommand('nexusflow.syncWorkspace', syncWsHandler));

    // Register Run Doctor Command
    const doctorHandler = () => {
        runContextSpaceCommand(context, 'doctor');
    };
    context.subscriptions.push(vscode.commands.registerCommand('contextspace.runDoctor', doctorHandler));
    context.subscriptions.push(vscode.commands.registerCommand('nexusflow.runDoctor', doctorHandler));

function escapeShellDoubleQuotes(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
}

    // Register Commit Workspace Command
    const commitHandler = async () => {
        const message = await vscode.window.showInputBox({
            prompt: 'Enter commit message for all changed repositories in the workspace:',
            placeHolder: 'e.g., feat: implement new UI components'
        });
        if (message) {
            const escaped = escapeShellDoubleQuotes(message);
            runContextSpaceCommand(context, `commit "${escaped}"`);
        }
    };
    context.subscriptions.push(vscode.commands.registerCommand('contextspace.commitWorkspace', commitHandler));
    context.subscriptions.push(vscode.commands.registerCommand('nexusflow.commitWorkspace', commitHandler));
}

function runContextSpaceCommand(context: vscode.ExtensionContext, command: string) {
    const folders = vscode.workspace.workspaceFolders;
    const isCreate = command.startsWith('create');
    
    if (!isCreate && (!folders || folders.length === 0)) {
        vscode.window.showErrorMessage('No active workspace folders found.');
        return;
    }
    
    const cwd = (folders && folders.length > 0) ? folders[0].uri.fsPath : undefined;
    const { command: cliCommand, prefixArgs } = resolveCli(context);

    let terminal = vscode.window.terminals.find((t: vscode.Terminal) => t.name === "ContextSpace Runner" || t.name === "NexusFlow Runner");
    if (!terminal) {
        terminal = vscode.window.createTerminal({
            name: "ContextSpace Runner",
            cwd: cwd
        });
    } else {
        // send Ctrl+C to cancel any active operations
        terminal.sendText('\u0003', true);
    }
    terminal.show(true);
    const invocation = prefixArgs.length > 0
        ? `${cliCommand} "${prefixArgs[0]}"`
        : cliCommand;
    terminal.sendText(`${invocation} ${command}`);
}

const runNexusFlowCommand = runContextSpaceCommand;

export function deactivate() {
    if (serverProcess) {
        console.log('Stopping Hono server...');
        serverProcess.kill();
    }
}

function getWorkspaceDetails(): any {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return { hasWorkspace: false };
    }
    const rootPath = folders[0].uri.fsPath;
    let manifestPath = path.join(rootPath, 'contextspace.json');
    if (!fs.existsSync(manifestPath)) {
        manifestPath = path.join(rootPath, 'nexusflow.json');
    }
    if (!fs.existsSync(manifestPath)) {
        return { hasWorkspace: false };
    }
    try {
        const content = fs.readFileSync(manifestPath, 'utf8');
        const data = JSON.parse(content);
        return {
            hasWorkspace: true,
            rootPath,
            id: data.id || data.branchName,
            branchName: data.branchName,
            description: data.description || 'No description',
            repos: (data.repos || []).map((repo: string) => ({
                name: path.basename(repo),
                path: repo
            }))
        };
    } catch (e) {
        return { hasWorkspace: false };
    }
}

class ContextSpaceSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'contextspace.dashboardView';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _context: vscode.ExtensionContext,
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._context.extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage((data: any) => {
            switch (data.type) {
                case 'openWorkspaceFolder': {
                    const uri = vscode.Uri.file(data.workspacePath);
                    vscode.commands.executeCommand('vscode.openFolder', uri, false);
                    break;
                }
                case 'openFile': {
                    const uri = vscode.Uri.file(data.filePath);
                    vscode.workspace.openTextDocument(uri).then((doc: vscode.TextDocument) => {
                        vscode.window.showTextDocument(doc);
                    });
                    break;
                }
                case 'getWorkspaceStatus': {
                    const details = getWorkspaceDetails();
                    webviewView.webview.postMessage({ type: 'workspaceStatus', details });
                    break;
                }
                case 'runCommand': {
                    runContextSpaceCommand(this._context, data.command);
                    break;
                }
                case 'triggerCommand': {
                    vscode.commands.executeCommand(data.command);
                    break;
                }
                case 'executeTerminalCommand': {
                    let terminal = vscode.window.terminals.find((t: vscode.Terminal) => t.name === "ContextSpace Runner" || t.name === "NexusFlow Runner");
                    if (!terminal) {
                        terminal = vscode.window.createTerminal({
                            name: "ContextSpace Runner",
                            cwd: data.cwd
                        });
                    } else {
                        // send Ctrl+C to cancel any active operations
                        terminal.sendText('\u0003', true);
                    }
                    terminal.show(true);
                    terminal.sendText(data.command);
                    break;
                }
            }
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const nonce = getNonce();
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css')
        );
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src ${webview.cspSource} 'unsafe-inline';
                 script-src 'nonce-${nonce}';
                 font-src ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${codiconsUri}" rel="stylesheet" />
    <title>ContextSpace Sidebar Console</title>
    <style>
        :root {
            --bg-base: var(--vscode-sideBar-background, #080a13);
            --bg-surface: var(--vscode-editor-background, #0d1127);
            --accent-cyan: #00f0ff;
            --accent-green: #39ff14;
            --text-primary: var(--vscode-sideBar-foreground, #f0f3ff);
            --text-secondary: var(--vscode-descriptionForeground, #8e9bb4);
            --border-color: rgba(0, 240, 255, 0.15);
        }

        body {
            background-color: var(--bg-base);
            color: var(--text-primary);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            padding: 12px;
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 8px;
            margin-bottom: 4px;
        }

        .header h3 {
            margin: 0;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            color: var(--accent-cyan);
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .status-indicator {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 10px;
            color: var(--accent-green);
            background: rgba(57, 255, 20, 0.1);
            padding: 2px 6px;
            border-radius: 10px;
            border: 1px solid rgba(57, 255, 20, 0.3);
        }

        .status-dot {
            width: 6px;
            height: 6px;
            background-color: var(--accent-green);
            border-radius: 50%;
            box-shadow: 0 0 6px var(--accent-green);
        }

        .card {
            background-color: var(--bg-surface);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .card h4 {
            margin: 0;
            font-size: 11px;
            text-transform: uppercase;
            color: var(--text-secondary);
            letter-spacing: 0.5px;
        }

        .branch-badge {
            font-family: var(--vscode-editor-font-family, monospace);
            color: var(--accent-cyan);
            font-weight: bold;
            font-size: 12px;
            background: rgba(0, 240, 255, 0.1);
            padding: 4px 8px;
            border-radius: 4px;
            border: 1px solid rgba(0, 240, 255, 0.2);
            word-break: break-all;
        }

        .desc-text {
            font-size: 11px;
            color: var(--text-secondary);
            line-height: 1.4;
        }

        .btn-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
        }

        .btn {
            background-color: var(--vscode-button-secondaryBackground, #2b3040);
            color: var(--vscode-button-secondaryForeground, #ffffff);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 6px 10px;
            font-size: 11px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.2s ease;
        }

        .btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground, #3c4257);
            border-color: var(--accent-cyan);
            color: var(--accent-cyan);
        }

        .btn-primary {
            background-color: var(--vscode-button-background, #007acc);
            color: var(--vscode-button-foreground, #ffffff);
            border: none;
        }

        .btn-primary:hover {
            background-color: var(--vscode-button-hoverBackground, #0062a3);
            color: #ffffff;
        }

        .file-list {
            list-style: none;
            padding: 0;
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .file-row {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 6px;
            border-radius: 4px;
            font-size: 11px;
            font-family: var(--vscode-editor-font-family, monospace);
            cursor: pointer;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid transparent;
        }

        .file-row:hover {
            background: rgba(0, 240, 255, 0.08);
            border-color: rgba(0, 240, 255, 0.3);
            color: var(--accent-cyan);
        }

        .file-icon {
            color: var(--accent-cyan);
            font-size: 12px;
        }

        .wizard-view {
            text-align: center;
            padding: 24px 12px;
        }

        .wizard-icon {
            font-size: 32px;
            color: var(--accent-cyan);
            margin-bottom: 12px;
        }

        .wizard-text {
            color: var(--text-secondary);
            font-size: 12px;
            margin-bottom: 20px;
            line-height: 1.5;
        }
    </style>
</head>
<body>

    <div class="header">
        <h3><i class="codicon codicon-extensions"></i> ContextSpace</h3>
        <div class="status-indicator">
            <div class="status-dot"></div>
            <span>ACTIVE</span>
        </div>
    </div>

    <!-- Active Workspace View -->
    <div id="workspace-view" style="display: none;">
        <div class="card">
            <h4>Active Feature</h4>
            <div class="branch-badge" id="branch-badge">🌿 workspace</div>
            <div class="desc-text" id="workspace-desc">Loading workspace description...</div>
        </div>

        <div class="btn-grid">
            <button class="btn" onclick="runCommand('tui')"><i class="codicon codicon-terminal"></i> Open TUI</button>
            <button class="btn" onclick="runCommand('sync')"><i class="codicon codicon-sync"></i> Rebase Sync</button>
            <button class="btn" onclick="runCommand('doctor')"><i class="codicon codicon-pulse"></i> Run Doctor</button>
            <button class="btn" onclick="triggerCommand('contextspace.commitWorkspace')"><i class="codicon codicon-git-commit"></i> Commit</button>
        </div>

        <div class="card">
            <h4>Workspace Repositories</h4>
            <ul class="file-list" id="repo-list">
                <!-- Repo items injected here -->
            </ul>
        </div>

        <div class="card">
            <h4>Core Context Files</h4>
            <ul class="file-list" id="context-files">
                <!-- Links injected here -->
            </ul>
        </div>
    </div>

    <!-- Empty Wizard Setup View -->
    <div id="wizard-view" style="display: none;" class="wizard-view">
        <div class="wizard-icon"><i class="codicon codicon-rocket"></i></div>
        <h4 style="margin-bottom: 8px; font-size: 14px; color: var(--text-primary);">No Workspace Detected</h4>
        <p class="wizard-text">ContextSpace coordinates multi-repo workspaces with Git worktrees and auto-generated AI contexts.</p>
        
        <button class="btn btn-primary" onclick="triggerCommand('contextspace.createWorkspace')" style="width: 100%; margin-bottom: 10px;">
            Initialize Workspace Setup
        </button>
        <button class="btn" onclick="triggerCommand('contextspace.openTui')" style="width: 100%;">
            Open TUI Dashboard
        </button>
    </div>

    <!-- Loading View -->
    <div id="loading-view" class="loading-view">
        <p style="color: var(--text-secondary);">Querying workspace configuration...</p>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        // Listen for messages from extension backend
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'workspaceStatus') {
                renderWorkspace(message.details);
            }
        });

        // Request workspace status on load
        vscode.postMessage({ type: 'getWorkspaceStatus' });

        function runCommand(cmd) {
            vscode.postMessage({ type: 'runCommand', command: cmd });
        }

        function triggerCommand(cmd) {
            vscode.postMessage({ type: 'triggerCommand', command: cmd });
        }

        function openFile(path) {
            vscode.postMessage({ type: 'openFile', filePath: path });
        }

        function renderWorkspace(details) {
            document.getElementById('loading-view').style.display = 'none';

            if (details.hasWorkspace) {
                document.getElementById('wizard-view').style.display = 'none';
                document.getElementById('workspace-view').style.display = 'block';

                document.getElementById('branch-badge').innerText = '🌿 ' + details.branchName;
                document.getElementById('workspace-desc').innerText = details.description;

                // Render Repos list
                const repoList = document.getElementById('repo-list');
                repoList.innerHTML = details.repos.map(r => \`
                    <li class="file-row" onclick="openFile('\${r.path.replace(/\\\\/g, '/')}')">
                        <i class="codicon codicon-folder file-icon"></i>
                        <span>\${r.name}</span>
                    </li>
                \`).join('');

                // Render Core Context Files list
                const contextFiles = document.getElementById('context-files');
                const root = details.rootPath.replace(/\\\\/g, '/');
                const files = ['WORKSPACE.md', 'contextspace-knowledge.md', 'contextspace-plan.md'];
                contextFiles.innerHTML = files.map(file => \`
                    <li class="file-row" onclick="openFile('\${root}/\${file}')">
                        <i class="codicon codicon-file-text file-icon"></i>
                        <span>\${file}</span>
                    </li>
                \`).join('');

            } else {
                document.getElementById('workspace-view').style.display = 'none';
                document.getElementById('wizard-view').style.display = 'block';
            }
        }
    </script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function updateStatusBarItem() {
    if (!myStatusBarItem) {
        return;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        const branchName = path.basename(folders[0].uri.fsPath);
        myStatusBarItem.text = `$(git-branch) ContextSpace: ${branchName}`;
        myStatusBarItem.tooltip = 'Click to open ContextSpace Terminal Console (TUI)';
        myStatusBarItem.show();
    } else {
        myStatusBarItem.hide();
    }
}
