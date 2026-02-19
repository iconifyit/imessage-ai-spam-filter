/**
 * @fileoverview Plugin Loader
 *
 * Loads classification and action plugins from:
 * - YAML files (simple regex/string matching rules)
 * - Code files (TS/JS exporting ClassificationPlugin/ActionPlugin)
 *
 * @module @tagrouter/engine/plugins/PluginLoader
 */

import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join, extname, basename } from "path";
import { parse as parseYaml } from "yaml";
import type { ClassificationPlugin, ClassificationContext } from "../contracts/ClassificationPlugin.js";
import type { ActionPlugin } from "../contracts/ActionPlugin.js";
import type { ClassificationOutput, MessageType } from "../contracts/ClassificationOutput.js";
import type { Entity } from "../contracts/Entity.js";
import { isClassificationPlugin } from "../contracts/ClassificationPlugin.js";
import { isActionPlugin } from "../contracts/ActionPlugin.js";

/**
 * YAML plugin definition for classification rules.
 */
export interface YamlClassifierDefinition {
    /** Unique name/id for this rule */
    name: string;

    /** Human-readable description */
    description?: string;

    /** Match criteria */
    match: {
        /** Regex pattern to match against message content */
        regex?: string;

        /** Exact string to match (case-insensitive) */
        contains?: string;

        /** Sender pattern to match */
        sender?: string;
    };

    /** MessageType to return on match */
    type: MessageType;

    /** Confidence score (default 1.0) */
    confidence?: number;

    /** Optional tags to include */
    tags?: string[];
}

/**
 * YAML plugin definition for action bindings.
 */
export interface YamlActionDefinition {
    /** Unique name/id for this action */
    name: string;

    /** Human-readable description */
    description?: string;

    /** Built-in action to invoke */
    action: string;

    /** Types this action handles */
    types: MessageType[];

    /** Minimum confidence per type (optional) */
    minConfidence?: number;
}

/**
 * Loaded plugins result.
 */
export interface LoadedPlugins {
    classifiers: ClassificationPlugin[];
    actions: ActionPlugin[];
}

/**
 * Plugin loader configuration.
 */
export interface PluginLoaderConfig {
    /** Logger for plugin loading */
    logger?: PluginLoaderLogger;
}

/**
 * Logger interface for plugin loader.
 */
export interface PluginLoaderLogger {
    debug(message: string, data?: Record<string, unknown>): void;
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Default console logger.
 */
const defaultLogger: PluginLoaderLogger = {
    debug: (msg, data) => console.debug(`[PluginLoader] ${msg}`, data ?? ""),
    info : (msg, data) => console.info(`[PluginLoader] ${msg}`, data ?? ""),
    warn : (msg, data) => console.warn(`[PluginLoader] ${msg}`, data ?? ""),
    error: (msg, data) => console.error(`[PluginLoader] ${msg}`, data ?? ""),
};

/**
 * Create a ClassificationPlugin from a YAML definition.
 *
 * @param def - YAML classifier definition
 * @returns ClassificationPlugin that matches based on the definition
 */
export function createClassifierFromYaml(def: YamlClassifierDefinition): ClassificationPlugin {
    const regexPattern = def.match.regex ? new RegExp(def.match.regex, "i") : null;
    const containsLower = def.match.contains?.toLowerCase();
    const senderPattern = def.match.sender ? new RegExp(def.match.sender, "i") : null;

    return {
        id         : `yaml:${def.name}`,
        name       : def.name,
        description: def.description,

        classify(message: Entity<object>, _context: ClassificationContext): ClassificationOutput | null {
            const content = message.content?.toLowerCase() ?? "";
            const sender = (message.metadata as { sender?: string })?.sender ?? "";

            // Check regex match
            if (regexPattern && regexPattern.test(message.content)) {
                return {
                    type      : def.type,
                    confidence: def.confidence ?? 1.0,
                    tags      : def.tags,
                };
            }

            // Check contains match
            if (containsLower && content.includes(containsLower)) {
                return {
                    type      : def.type,
                    confidence: def.confidence ?? 1.0,
                    tags      : def.tags,
                };
            }

            // Check sender match
            if (senderPattern && senderPattern.test(sender)) {
                return {
                    type      : def.type,
                    confidence: def.confidence ?? 1.0,
                    tags      : def.tags,
                };
            }

            return null;
        },
    };
}

/**
 * Plugin Loader
 *
 * Loads plugins from directories containing YAML and/or code files.
 *
 * @example
 * ```typescript
 * const loader = new PluginLoader();
 *
 * // Load from a directory
 * const plugins = await loader.loadFromDirectory("./plugins");
 *
 * // Register with engine
 * for (const classifier of plugins.classifiers) {
 *     domain.classifiers.push(classifier);
 * }
 * ```
 */
export class PluginLoader {
    private readonly logger: PluginLoaderLogger;

    constructor(config: PluginLoaderConfig = {}) {
        this.logger = config.logger ?? defaultLogger;
    }

    /**
     * Load all plugins from a directory.
     *
     * Scans for:
     * - .yml/.yaml files → YAML plugins
     * - .js/.ts files → Code plugins
     *
     * @param dirPath - Path to plugins directory
     * @returns Loaded classifiers and actions
     */
    async loadFromDirectory(dirPath: string): Promise<LoadedPlugins> {
        const result: LoadedPlugins = {
            classifiers: [],
            actions    : [],
        };

        if (!existsSync(dirPath)) {
            this.logger.warn("Plugin directory does not exist", { dirPath });
            return result;
        }

        const stat = statSync(dirPath);
        if (!stat.isDirectory()) {
            this.logger.warn("Plugin path is not a directory", { dirPath });
            return result;
        }

        const files = readdirSync(dirPath);

        for (const file of files) {
            const filePath = join(dirPath, file);
            const ext = extname(file).toLowerCase();

            try {
                if (ext === ".yml" || ext === ".yaml") {
                    const loaded = this.loadYamlFile(filePath);
                    result.classifiers.push(...loaded.classifiers);
                    result.actions.push(...loaded.actions);
                }
                else if (ext === ".js" || ext === ".mjs") {
                    const loaded = await this.loadCodeFile(filePath);
                    result.classifiers.push(...loaded.classifiers);
                    result.actions.push(...loaded.actions);
                }
            }
            catch (error) {
                this.logger.error("Failed to load plugin file", {
                    filePath,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        this.logger.info("Plugins loaded from directory", {
            dirPath,
            classifiers: result.classifiers.length,
            actions    : result.actions.length,
        });

        return result;
    }

    /**
     * Load plugins from a YAML file.
     *
     * @param filePath - Path to YAML file
     * @returns Loaded classifiers and actions
     */
    loadYamlFile(filePath: string): LoadedPlugins {
        const result: LoadedPlugins = {
            classifiers: [],
            actions    : [],
        };

        const content = readFileSync(filePath, "utf-8");
        const parsed = parseYaml(content);

        if (!parsed) {
            return result;
        }

        // Handle array of definitions
        const definitions = Array.isArray(parsed) ? parsed : [parsed];

        for (const def of definitions) {
            if (this.isYamlClassifierDefinition(def)) {
                const classifier = createClassifierFromYaml(def);
                result.classifiers.push(classifier);
                this.logger.debug("Loaded YAML classifier", { id: classifier.id });
            }
        }

        return result;
    }

    /**
     * Load plugins from a code file (JS/TS).
     *
     * Looks for exports that match ClassificationPlugin or ActionPlugin.
     *
     * @param filePath - Path to JS/TS file
     * @returns Loaded classifiers and actions
     */
    async loadCodeFile(filePath: string): Promise<LoadedPlugins> {
        const result: LoadedPlugins = {
            classifiers: [],
            actions    : [],
        };

        // Dynamic import
        const module = await import(filePath);

        // Check all exports
        for (const key of Object.keys(module)) {
            const exported = module[key];

            if (isClassificationPlugin(exported)) {
                result.classifiers.push(exported);
                this.logger.debug("Loaded code classifier", { id: exported.id, export: key });
            }
            else if (isActionPlugin(exported)) {
                result.actions.push(exported);
                this.logger.debug("Loaded code action", { id: exported.id, export: key });
            }
        }

        // Check default export
        if (module.default) {
            if (isClassificationPlugin(module.default)) {
                result.classifiers.push(module.default);
                this.logger.debug("Loaded default classifier", { id: module.default.id });
            }
            else if (isActionPlugin(module.default)) {
                result.actions.push(module.default);
                this.logger.debug("Loaded default action", { id: module.default.id });
            }
            else if (Array.isArray(module.default)) {
                // Array of plugins
                for (const item of module.default) {
                    if (isClassificationPlugin(item)) {
                        result.classifiers.push(item);
                    }
                    else if (isActionPlugin(item)) {
                        result.actions.push(item);
                    }
                }
            }
        }

        return result;
    }

    /**
     * Load plugins from multiple directories.
     *
     * @param dirPaths - Array of directory paths
     * @returns Combined loaded plugins
     */
    async loadFromDirectories(dirPaths: string[]): Promise<LoadedPlugins> {
        const result: LoadedPlugins = {
            classifiers: [],
            actions    : [],
        };

        for (const dirPath of dirPaths) {
            const loaded = await this.loadFromDirectory(dirPath);
            result.classifiers.push(...loaded.classifiers);
            result.actions.push(...loaded.actions);
        }

        return result;
    }

    /**
     * Type guard for YAML classifier definition.
     */
    private isYamlClassifierDefinition(obj: unknown): obj is YamlClassifierDefinition {
        return (
            typeof obj === "object" &&
            obj !== null &&
            "name" in obj &&
            "match" in obj &&
            "type" in obj
        );
    }
}
