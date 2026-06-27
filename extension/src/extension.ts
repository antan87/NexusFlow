import * as vscode from 'vscode';
import * as http from 'http';
import * as child_process from 'child_process';
import * as path from 'path';

let serverProcess: child_process.ChildProcess | null = null;

function checkServerRunning(): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.get('http://localhost:3000/api/config', (res) => {
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
    const serverScript = path.join(context.extensionPath, '..', 'dist', 'index.js');
    
    serverProcess = child_process.spawn('node', [serverScript, 'ui'], {
        cwd: path.join(context.extensionPath, '..'),
        env: { ...process.env, PORT: '3000' },
        detached: false
    });

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

    // Register Webview Provider
    const provider = new NexusFlowSidebarProvider(context.extensionUri);
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
                const serverScript = path.join(context.extensionPath, '..', 'dist', 'index.js');
                const workspaceFolders = vscode.workspace.workspaceFolders;
                const args = [serverScript, 'mcp', 'run'];
                if (workspaceFolders && workspaceFolders.length > 0) {
                    args.push(workspaceFolders[0].uri.fsPath);
                }
                
                return [
                    new (vscode as any).McpStdioServerDefinition({
                        label: 'NexusFlow MCP Server',
                        command: 'node',
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
            vscode.env.openExternal(vscode.Uri.parse('http://localhost:3000'));
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
    const serverScript = path.join(context.extensionPath, '..', 'dist', 'index.js');
    
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
    const escapedScriptPath = `"${serverScript}"`;
    terminal.sendText(`node ${escapedScriptPath} ${command}`);
}

export function deactivate() {
    if (serverProcess) {
        console.log('Stopping Hono server...');
        serverProcess.kill();
    }
}

class NexusFlowSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'nexusflow.dashboardView';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
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
                this._extensionUri
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
        let workspaceParam = '';
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspacePath = workspaceFolders[0].uri.fsPath;
            const workspaceId = path.basename(workspacePath);
            workspaceParam = `&workspaceId=${encodeURIComponent(workspaceId)}`;
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NexusFlow Dashboard</title>
    <style>
        html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background-color: var(--vscode-sideBar-background, #0b0f19);
        }
        iframe {
            width: 100%;
            height: 100%;
            border: none;
        }
    </style>
</head>
<body>
    <iframe src="http://localhost:3000?env=vscode${workspaceParam}"></iframe>
    <script>
        const vscode = acquireVsCodeApi();
        window.addEventListener('message', event => {
            // Forward messages from iframe to VS Code extension
            vscode.postMessage(event.data);
        });
    </script>
</body>
</html>`;
    }
}
