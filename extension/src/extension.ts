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
    return { command: process.platform === 'win32' ? 'nexusflow.cmd' : 'nexusflow', prefixArgs: [] };
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
    console.log('NexusFlow extension is activating...');
    
    // Start Hono server in background if not running
    startHonoServer(context);

    // Scope keybindings to workspaces where nexusflow.json exists
    vscode.commands.executeCommand('setContext', 'nexusflow.workspaceActive', true);

    // Initialize Status Bar Item
    myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    myStatusBarItem.command = 'nexusflow.openTui';
    context.subscriptions.push(myStatusBarItem);
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(updateStatusBarItem));
    updateStatusBarItem();

    // Register Webview Provider
    const provider = new NexusFlowSidebarProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            NexusFlowSidebarProvider.viewType,
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
                        label: 'NexusFlow MCP Server',
                        command,
                        args: args
                    })
                ];
            }
        };
        context.subscriptions.push(
            (vscode as any).lm.registerMcpServerDefinitionProvider('nexusflow-mcp', mcpProvider)
        );
        console.log('NexusFlow MCP Server Definition Provider registered successfully.');
    } else {
        console.log('registerMcpServerDefinitionProvider is not supported on this VS Code version.');
    }

    // Register Focus Dashboard Command
    context.subscriptions.push(
        vscode.commands.registerCommand('nexusflow.openDashboard', () => {
            vscode.commands.executeCommand('workbench.view.extension.nexusflow-sidebar');
        })
    );

    // Register Open Browser Dashboard Command
    context.subscriptions.push(
        vscode.commands.registerCommand('nexusflow.openBrowserDashboard', () => {
            vscode.env.openExternal(vscode.Uri.parse(SERVER_URL));
        })
    );

    // Register Open TUI Command
    context.subscriptions.push(
        vscode.commands.registerCommand('nexusflow.openTui', () => {
            runNexusFlowCommand(context, 'tui');
        })
    );

    // Register Create Workspace Command
    context.subscriptions.push(
        vscode.commands.registerCommand('nexusflow.createWorkspace', () => {
            runNexusFlowCommand(context, 'create');
        })
    );

    // Register Sync Workspace Command
    context.subscriptions.push(
        vscode.commands.registerCommand('nexusflow.syncWorkspace', () => {
            runNexusFlowCommand(context, 'sync');
        })
    );

    // Register Run Doctor Command
    context.subscriptions.push(
        vscode.commands.registerCommand('nexusflow.runDoctor', () => {
            runNexusFlowCommand(context, 'doctor');
        })
    );

    // Register Commit Workspace Command
    context.subscriptions.push(
        vscode.commands.registerCommand('nexusflow.commitWorkspace', async () => {
            const message = await vscode.window.showInputBox({
                prompt: 'Enter commit message for all changed repositories in the workspace:',
                placeHolder: 'e.g., feat: implement new UI components'
            });
            if (message) {
                runNexusFlowCommand(context, `commit "${message.replace(/"/g, '\\"')}"`);
            }
        })
    );
}

function runNexusFlowCommand(context: vscode.ExtensionContext, command: string) {
    const folders = vscode.workspace.workspaceFolders;
    const isCreate = command.startsWith('create');
    
    if (!isCreate && (!folders || folders.length === 0)) {
        vscode.window.showErrorMessage('No active workspace folders found.');
        return;
    }
    
    const cwd = (folders && folders.length > 0) ? folders[0].uri.fsPath : undefined;
    const { command: cliCommand, prefixArgs } = resolveCli(context);

    let terminal = vscode.window.terminals.find((t: vscode.Terminal) => t.name === "NexusFlow Runner");
    if (!terminal) {
        terminal = vscode.window.createTerminal({
            name: "NexusFlow Runner",
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
    const manifestPath = path.join(rootPath, 'nexusflow.json');
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

class NexusFlowSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'nexusflow.dashboardView';
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
                    runNexusFlowCommand(this._context, data.command);
                    break;
                }
                case 'triggerCommand': {
                    vscode.commands.executeCommand(data.command);
                    break;
                }
                case 'executeTerminalCommand': {
                    let terminal = vscode.window.terminals.find((t: vscode.Terminal) => t.name === "NexusFlow Runner");
                    if (!terminal) {
                        terminal = vscode.window.createTerminal({
                            name: "NexusFlow Runner",
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
    <title>NexusFlow Sidebar Console</title>
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

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
            background-color: var(--bg-base);
            color: var(--text-primary);
            padding: 12px;
            font-size: 13px;
            overflow-y: auto;
            min-height: 100vh;
        }

        /* Header block */
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 8px;
            margin-bottom: 15px;
        }

        .header h3 {
            font-size: 14px;
            font-weight: bold;
            color: var(--text-primary);
            letter-spacing: 0.5px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .status-indicator {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
            color: var(--accent-cyan);
            font-family: monospace;
        }

        .status-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background-color: var(--accent-green);
            box-shadow: 0 0 6px var(--accent-green);
        }

        /* Card Container */
        .card {
            background-color: var(--bg-surface);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 15px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        }

        .card h4 {
            font-size: 12px;
            color: var(--accent-cyan);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 6px;
        }

        .branch-badge {
            font-family: monospace;
            background: rgba(0, 240, 255, 0.08);
            border: 1px solid rgba(0, 240, 255, 0.2);
            color: var(--accent-cyan);
            padding: 4px 8px;
            border-radius: 4px;
            display: inline-block;
            margin-bottom: 8px;
            font-weight: bold;
        }

        .desc-text {
            color: var(--text-secondary);
            font-size: 12px;
            line-height: 1.4;
        }

        /* Action Buttons Grid */
        .btn-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-bottom: 15px;
        }

        .btn {
            background: rgba(0, 240, 255, 0.06);
            border: 1px solid rgba(0, 240, 255, 0.2);
            color: var(--accent-cyan);
            border-radius: 4px;
            padding: 8px 12px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.2s ease;
        }

        .btn:hover {
            background: var(--accent-cyan);
            color: black;
            box-shadow: 0 0 10px rgba(0, 240, 255, 0.25);
        }

        .btn-primary {
            grid-column: span 2;
            background: var(--accent-cyan);
            color: black;
            font-weight: bold;
        }

        .btn-primary:hover {
            background: #00d0de;
        }

        /* File Links List */
        .file-list {
            list-style: none;
        }

        .file-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 8px;
            border-radius: 4px;
            cursor: pointer;
            color: var(--text-secondary);
            transition: all 0.2s ease;
        }

        .file-row:hover {
            background: rgba(255, 255, 255, 0.03);
            color: var(--text-primary);
        }

        .file-icon {
            color: var(--accent-cyan);
            font-size: 14px;
        }

        /* Loading / Wizard view */
        .loading-view, .wizard-view {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 30px 15px;
            text-align: center;
        }

        .wizard-icon {
            font-size: 32px;
            margin-bottom: 12px;
            animation: pulse 2s infinite;
        }

        .wizard-text {
            color: var(--text-secondary);
            margin-bottom: 20px;
            line-height: 1.5;
        }
    </style>
</head>
<body>

    <div class="header">
        <h3><i class="codicon codicon-extensions"></i> NexusFlow</h3>
        <div class="status-indicator">
            <div class="status-dot"></div>
            <span>ACTIVE</span>
        </div>
    </div>

    <!-- Active Workspace View -->
    <div id="workspace-view" style="display: none;">
        <div class="card">
            <h4>Active Feature</h4>
            <div class="branch-badge" id="branch-badge">🌿 improve_nexusflow</div>
            <div class="desc-text" id="workspace-desc">Loading workspace description...</div>
        </div>

        <div class="btn-grid">
            <button class="btn" onclick="runCommand('tui')"><i class="codicon codicon-terminal"></i> Open TUI</button>
            <button class="btn" onclick="runCommand('sync')"><i class="codicon codicon-sync"></i> Rebase Sync</button>
            <button class="btn" onclick="runCommand('doctor')"><i class="codicon codicon-pulse"></i> Run Doctor</button>
            <button class="btn" onclick="triggerCommand('nexusflow.commitWorkspace')"><i class="codicon codicon-git-commit"></i> Commit</button>
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
        <p class="wizard-text">NexusFlow coordinates multi-repo workspaces with Git worktrees and auto-generated AI contexts.</p>
        
        <button class="btn btn-primary" onclick="triggerCommand('nexusflow.createWorkspace')" style="width: 100%; margin-bottom: 10px;">
            Initialize Workspace Setup
        </button>
        <button class="btn" onclick="triggerCommand('nexusflow.openTui')" style="width: 100%;">
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
                const files = ['WORKSPACE.md', 'nexusflow-knowledge.md', 'nexusflow-plan.md'];
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
        myStatusBarItem.text = `$(git-branch) NexusFlow: ${branchName}`;
        myStatusBarItem.tooltip = 'Click to open NexusFlow Terminal Console (TUI)';
        myStatusBarItem.show();
    } else {
        myStatusBarItem.hide();
    }
}

