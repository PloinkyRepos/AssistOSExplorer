#!/bin/sh

# Read JSON payload from stdin.
payload="$(cat)"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export SOPLANG_TOOL_DIR="${SCRIPT_DIR}"
export SOPLANG_TOOL_PAYLOAD="${payload}"
export PERSISTENCE_FOLDER="/persistoStorage"
export LOGS_FOLDER="/persistoLogs"
export AUDIT_FOLDER="/persistoAudit"

node --input-type=module <<'NODE'
import fs from 'fs';
import path from 'path';
import {pathToFileURL} from 'url';

const toolDir = process.env.SOPLANG_TOOL_DIR;
const rawInput = process.env.SOPLANG_TOOL_PAYLOAD || '';
const logPath = path.join(toolDir, 'last-tool.log');
const toolName = process.env.TOOL_NAME;

if (!toolDir) {
    console.error('SOPLANG_TOOL_DIR is not set.');
    process.exit(1);
}

if (!toolName) {
    console.error('TOOL_NAME is not set.');
    process.exit(1);
}

if (!rawInput.trim()) {
    console.error('No input received. Provide JSON via stdin.');
    process.exit(1);
}

if (typeof globalThis.$$ === 'undefined') {
    globalThis.$$ = {};
}

// Reset log file for each invocation
try {
    fs.writeFileSync(logPath, '');
} catch (e) {
    console.error(`Failed to prepare log file ${logPath}: ${e.message}`);
}

const appendLog = (msg) => {
    try {
        fs.appendFileSync(logPath, `${msg}\n`);
    } catch (e) {
        console.error(`Failed to write log file ${logPath}: ${e.message}`);
    }
};

const writeStderr = (...args) => {
    const text = args.map((arg) => {
        if (arg === undefined) return 'undefined';
        if (arg === null) return 'null';
        if (typeof arg === 'string') return arg;
        try {
            return JSON.stringify(arg);
        } catch {
            return String(arg);
        }
    }).join(' ');
    try {
        process.stderr.write(text + '\n');
    } catch (_) {}
    appendLog(text);
};

console.log = writeStderr;
console.info = writeStderr;
console.warn = writeStderr;
console.error = writeStderr;
console.debug = writeStderr;

if (typeof globalThis.$$.throwError === 'undefined') {
    globalThis.$$.throwError = async function throwError(error, ...args) {
        if (typeof error === 'string') {
            error = new Error(error + ' ' + args.join(' '));
        }
        throw error;
    };
}

if (typeof globalThis.$$.throwAsyncError === 'undefined') {
    globalThis.$$.throwAsyncError = async function throwAsyncError(error, ...args) {
        return $$.throwError(error, ...args);
    };
}

const plugins = {};
let loadOrder = [];

const loadPluginModule = async (pluginPath) => {
    try {
        return await import(pathToFileURL(pluginPath));
    } catch (e) {
        throw new Error(`Cannot load plugin module at path ${pluginPath}: ${e.message}`);
    }
};

const registerPlugin = async (pluginName, pluginModule) => {
    if (!pluginModule) {
        throw new Error(`Module at path for plugin ${pluginName} does not export anything`);
    }
    if (typeof pluginModule.getInstance !== 'function') {
        throw new Error(`Module for ${pluginName} does not export a function called getInstance`);
    }
    if (typeof pluginModule.getAllow !== 'function') {
        throw new Error(`Module for ${pluginName} does not export a function called getAllow`);
    }

    const captured = [];
    const originalConsole = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
        debug: console.debug,
    };
    const capture = (...args) => captured.push(args.map(arg => String(arg)).join(' '));
    let plugin;
    try {
        console.log = console.info = console.warn = console.error = console.debug = capture;
        plugin = await pluginModule.getInstance();
    } finally {
        console.log = originalConsole.log;
        console.info = originalConsole.info;
        console.warn = originalConsole.warn;
        console.error = originalConsole.error;
        console.debug = originalConsole.debug;
        appendLog(captured.join('\n'));
    }
    plugin.allow = await pluginModule.getAllow();
    if (!plugin) {
        throw new Error(`Module for plugin ${pluginName} did not return a plugin instance`);
    }

    if (plugins[pluginName]) {
        throw new Error(`Plugin ${pluginName} already registered`);
    }

    plugins[pluginName] = plugin;
    loadOrder.push(pluginName);

    if (pluginName === 'StandardPersistence' && !plugins['DefaultPersistence']) {
        plugins['DefaultPersistence'] = plugin;
    }
};

$$.registerPlugin = async (pluginName, pluginPath) => {
    const resolvedPath = path.isAbsolute(pluginPath) ? pluginPath : path.resolve(toolDir, pluginPath);
    const pluginModule = await loadPluginModule(resolvedPath);
    return registerPlugin(pluginName, pluginModule);
};

$$.loadPlugin = (pluginName) => {
    return plugins[pluginName];
};

await import(pathToFileURL(path.join(toolDir, 'src', 'util', 'debugUtil.js'))).catch(() => {});
const { deriveInvocation } = await import(pathToFileURL(path.join(toolDir, 'plugins', 'lib', 'toolInvocation.mjs')));

let payload;
try {
    let parsed = JSON.parse(rawInput);
    payload = parsed.input || {};
} catch (err) {
    console.error(`Invalid JSON input: ${err.message}`);
    process.exit(1);
}

let invocation;
try {
    invocation = deriveInvocation(toolName, payload);
} catch (error) {
    console.error(error.message);
    process.exit(1);
}

const {pluginName, methodName, params = []} = invocation;

if (!pluginName || typeof pluginName !== 'string') {
    console.error('"pluginName" must be a non-empty string.');
    process.exit(1);
}
if (!methodName || typeof methodName !== 'string') {
    console.error('"methodName" must be a non-empty string.');
    process.exit(1);
}
if (!Array.isArray(params)) {
    console.error('"params" must be an array.');
    process.exit(1);
}

const pluginsDir = path.join(toolDir,'node_modules','soplang','plugins');

if (!fs.existsSync(pluginsDir)) {
    console.error(`Plugins directory not found at ${pluginsDir}`);
    process.exit(1);
}

const manualPlugins = [
    {name: 'DefaultPersistence', file: 'StandardPersistence.js'},
    {name: 'Workspace', file: 'Workspace.js'},
    {name: 'Agent', file: 'Agent.js'},
    {name: 'WorkspaceUser', file: 'WorkspaceUser.js'},
    {name: 'Documents', file: 'Documents.js'},
    {name: 'Table', file: 'Table.js'},
    {name: 'LLM', file: 'LLM.js'},
    {name: 'ChatRoom', file: 'ChatRoom.js'},
];

for (const {name, file} of manualPlugins) {
    const pluginFile = path.join(pluginsDir, file);
    if (!fs.existsSync(pluginFile)) {
        console.warn(`Plugin file not found for ${name} at ${pluginFile}`);
        continue;
    }
    try {
        await $$.registerPlugin(name, pluginFile);
        appendLog(`Registered plugin: ${name}`);
    } catch (error) {
        console.error(`Error registering plugin ${name}: ${error.message}`);
    }
}

const achillesPluginPath = path.join(toolDir, 'plugins', 'AchillesSkills.js');
if (fs.existsSync(achillesPluginPath)) {
    try {
        await $$.registerPlugin("AchillesSkills", achillesPluginPath);
        appendLog("Registered plugin: AchillesSkills");
    } catch (error) {
        console.error(`Error registering plugin AchillesSkills: ${error.message}`);
    }
} else {
    console.warn(`AchillesSkills plugin not found at ${achillesPluginPath}`);
}

const soplangBuilderPath = path.join(toolDir, 'plugins', 'SoplangBuilder.js');
if (fs.existsSync(soplangBuilderPath)) {
    try {
        await $$.registerPlugin("SoplangBuilder", soplangBuilderPath);
        appendLog("Registered plugin: SoplangBuilder");
    } catch (error) {
        console.error(`Error registering plugin SoplangBuilder: ${error.message}`);
    }
} else {
    console.warn(`SoplangBuilder plugin not found at ${soplangBuilderPath}`);
}



const targetPlugin = plugins[pluginName];
if (!targetPlugin) {
    console.error(`Plugin ${pluginName} not found`);
    process.exit(1);
}

if (typeof targetPlugin.allow === 'function') {
    const canExecute = await targetPlugin.allow(undefined, undefined, methodName, ...params);
    if (canExecute === false) {
        console.error(`Not allowed to execute ${pluginName}.${methodName}`);
        process.exit(1);
    }
}

if (typeof targetPlugin[methodName] !== 'function') {
    console.error(`The plugin ${pluginName} does not implement the "${methodName}" method`);
    process.exit(1);
}

try {
    const result = await targetPlugin[methodName].call(targetPlugin, ...params);
    process.stdout.write(JSON.stringify(result));
    let workspace = plugins["Workspace"];
    await workspace.shutDown();
    process.exit(0);
} catch (err) {
    console.error(`Error executing ${pluginName}.${methodName}: ${err.message}`);
    process.exit(1);
}
NODE
