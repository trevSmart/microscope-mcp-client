#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
    CallToolResultSchema,
    ListToolsResultSchema,
    EmptyResultSchema,
    LoggingMessageNotificationSchema,
    ResourceListChangedNotificationSchema,
    ListResourcesResultSchema,
    ResourceUpdatedNotificationSchema,
    ListRootsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";


//import * as readline from "node:readline";

type ServerTarget =
    | {
        kind: "script";
        interpreter: "node" | "python";
        path: string;
        args: string[];
    }
    | {
        kind: "npx";
        pkg: string;
        version?: string;
        bin?: string;
        args: string[];
        npxArgs?: string[];
    };

function safeEnv(extra: Record<string, string> = {}): Record<string, string> {
    const cleaned = Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => typeof v === "string")
    ) as Record<string, string>;
    return { ...cleaned, ...extra };
}

function parseServerSpec(raw: string, serverArgs: string[]): { target: ServerTarget; } {
    // Forma: npx:@scope/pkg[@version][#bin]
    if (raw.startsWith("npx:")) {
        const spec = raw.slice("npx:".length);
        const [pkgAndVer, bin] = spec.split("#");

        const atIdx = pkgAndVer.lastIndexOf("@");
        let pkg = pkgAndVer;
        let version: string | undefined;
        // Si l'@ no és part de l'scope, l'interpretem com a versió
        if (atIdx > 0 && pkgAndVer.slice(atIdx - 1, atIdx) !== "/") {
            pkg = pkgAndVer.slice(0, atIdx);
            version = pkgAndVer.slice(atIdx + 1);
        }

        return {
            target: {
                kind: "npx",
                pkg,
                version,
                bin: bin || undefined,
                args: serverArgs,
                npxArgs: ["-y"], // evita prompts de npx
            },
        };
    }

    // Script local .js o .py
    const isPy = raw.endsWith(".py");
    const isJs = raw.endsWith(".js");
    if (!isPy && !isJs) {
        throw new Error(
            "Provide a .js/.py path or use the form npx:@scope/pkg[@ver][#bin]"
        );
    }

    return {
        target: {
            kind: "script",
            interpreter: isPy ? "python" : "node",
            path: raw,
            args: serverArgs,
        },
    };
}

class TestMcpClient {
    private client: Client | null = null;
    private transport: StdioClientTransport | null = null;
    private lastTools: Array<{ name: string; description?: string; inputSchema?: unknown; }> = [];
    private resources: Record<string, { uri: string; name: string; description?: string; mimeType?: string; annotations?: any }> = {};

    async connect(target: ServerTarget): Promise<void> {
        if (target.kind === "script") {
            const pythonCmd = process.env.PYTHON_CMD || "python";
            const cmd = target.interpreter === "node" ? process.execPath : pythonCmd;

            this.transport = new StdioClientTransport({
                command: cmd,
                args: [target.path, ...target.args],
                env: safeEnv(),
            });
        } else {
            const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
            const pkgWithVer = target.version ? `${target.pkg}@${target.version}` : target.pkg;

            const args = target.bin
                ? [...(target.npxArgs ?? ["-y"]), "-p", pkgWithVer, target.bin, ...target.args]
                : [...(target.npxArgs ?? ["-y"]), pkgWithVer, ...target.args];

            this.transport = new StdioClientTransport({
                command: npxCmd,
                args,
                env: safeEnv({ NO_UPDATE_NOTIFIER: "1" }),
            });
        }

        this.client = new Client(
            { name: "IBM Salesforce MCP Test Client", version: "0.0.1" },
            {
                capabilities: {
                    roots: { listChanged: true },
                    logging: {}
                }
            }
        );

        await this.client.connect(this.transport);

        const serverCapabilities = await this.client.getServerCapabilities();
        console.log(`Server capabilities: ${JSON.stringify(serverCapabilities, null, 2)}\n`);

        if (serverCapabilities?.logging) {
            this.client.setLoggingLevel("info");

            this.client!.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
                const { level, logger, data } = n.params;
                console.log(`Server log: [${level}]${logger ? ` [${logger}]` : ""}:`, data);
            });
        }

        this.client.setRequestHandler(ListRootsRequestSchema, async (_) => {
            return { roots: [] };
        });

        // Carregar la llista inicial de recursos
        if (serverCapabilities?.resources) {
            try {
                const resourcesResult = await this.client.request({ method: 'resources/list', params: {} }, ListResourcesResultSchema);
                this.resources = resourcesResult.resources.reduce((acc: Record<string, any>, r: any) => {
                    acc[r.uri] = {
                        uri: r.uri,
                        name: r.name,
                        description: r.description,
                        mimeType: r.mimeType,
                        annotations: r.annotations
                    };
                    return acc;
                }, {});
                if (Object.keys(this.resources).length) {
                    console.log(`Resources: ${Object.keys(this.resources).join(", ") || "(none)"}\n`);
                }
            } catch {
                console.log('Failed to load initial resources list');
            }
        }

        if (serverCapabilities?.resources) {
            this.client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
                try {
                    const resourcesResult = await this.client!.request({ method: 'resources/list', params: {} }, ListResourcesResultSchema);
                    this.resources = resourcesResult.resources.reduce((acc: Record<string, any>, r: any) => {
                        acc[r.uri] = {
                            uri: r.uri,
                            name: r.name,
                            description: r.description,
                            mimeType: r.mimeType,
                            annotations: r.annotations
                        };
                        return acc;
                    }, {});
                } catch {
                    console.log('Failed to list resources after change notification');
                }
            });

            this.client.setNotificationHandler(ResourceUpdatedNotificationSchema, async notification => {
                const { uri } = notification.params as { uri: string };

                // Actualitzar només el recurs específic que s'ha modificat
                try {
                    const resource = await this.client!.readResource({ uri });
                    this.resources[uri] = {
                        uri: uri,
                        name: typeof (resource as any).name === 'string' ? (resource as any).name : '',
                        description: typeof (resource as any).description === 'string' ? (resource as any).description : undefined,
                        mimeType: typeof (resource as any).mimeType === 'string' ? (resource as any).mimeType : undefined,
                        annotations: resource.annotations
                    };
                } catch (error) {
                    console.log(`Failed to update resource ${uri}:`, error);
                }
            });
        }

        this.client!.fallbackNotificationHandler = async notif => {
            console.warn("Gestió de tipus de notificació no implementada al client:", notif.method, notif.params);
        };

        this.client.sendRootsListChanged();

        const toolsList = await this.client.request({ method: "tools/list" }, ListToolsResultSchema);
        this.lastTools = toolsList.tools.map((t: any) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema ?? t.input_schema ?? t.inputschema,
        }));
        console.log(`Tools:\n   ${this.lastTools.map((t) => t.name).join("\n   ") || "(none)"}\n`);
    }

    private ensureConnected() {
        if (!this.client) {
            throw new Error("Client not connected");
        }
    }

    async setLoggingLevel(level: string) {
        const res = await this.client!.request(
            { method: "logging/setLevel", params: { level } },
            EmptyResultSchema
        );
    }


    async listTools(): Promise<void> {
        this.ensureConnected();
        const list = await this.client!.listTools();
    }

    getResources(): Array<{ uri: string; name: string; description?: string; mimeType?: string; annotations?: any }> {
        return Object.values(this.resources);
    }

    getResource(uri: string): { uri: string; name: string; description?: string; mimeType?: string; annotations?: any } | undefined {
        return this.resources[uri];
    }

    async callTool(name: string, args: unknown) {
        this.ensureConnected();
        return await this.client!.callTool({ name, arguments: args as Record<string, unknown> }, CallToolResultSchema);
    }

    async disconnect(): Promise<void> {
        if (this.transport) {
            await this.transport.close();
        }
    }

    private readonly LOG_LEVELS = [
        "debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"
    ];

    getLogLevels(): string[] {
        return this.LOG_LEVELS.slice();
    }

}

async function main() {
    const argv = process.argv.slice(2);
    if (argv.length < 1) {
        console.error(`
Usage:
  ts-node src/client.ts <path_or_npx_spec> [--cli] -- [serverArgs...]

Examples:
  ts-node src/client.ts "npx:@scope/mcp-server@0.3.1#mcp-server" --cli -- --stdio
  ts-node src/client.ts ./server.js --cli -- --stdio
  ts-node src/client.ts ./server.py -- --stdio
  ts-node src/client.ts ./server.js -- --stdio  # JSON-RPC listener mode (default)
`.trim());
        process.exit(2);
    }

    // Check if --cli flag is present
    const cliFlagIndex = argv.indexOf("--cli");
    const useCli = cliFlagIndex !== -1;

    // Remove --cli flag from arguments if present
    const cleanArgv = useCli ? argv.filter((_, index) => index !== cliFlagIndex) : argv;

    const sepIdx = cleanArgv.indexOf("--");
    const spec = cleanArgv[0];
    const serverArgs = sepIdx === -1 ? cleanArgv.slice(1) : cleanArgv.slice(sepIdx + 1);

    const { target } = parseServerSpec(spec, serverArgs);

    const cli = new TestMcpClient();
    try {
        await cli.connect(target);

    } catch (err) {
        console.error("Error:", err instanceof Error ? err.message : err);
        try {
            await cli.disconnect();
        } catch {
            // tant se val
        }
        process.exit(1);
    }
}

// Only run if invoked directly
if (import.meta.url === new URL(process.argv[1], "file:").href) {
    main();
}

// Exports per a ús com a llibreria
export { TestMcpClient };
export { Client } from "@modelcontextprotocol/sdk/client/index.js";
export { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
export type { ServerTarget };
