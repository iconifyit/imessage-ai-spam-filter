/**
 * Classification Plugin Contract
 *
 * Plugins that evaluate messages and return classification results.
 * The engine runs ALL classifiers and selects the highest confidence result.
 *
 * Design principles:
 * - Pure: No side effects, no message mutation
 * - Deterministic: Same input produces same output
 * - Independent: Each classifier runs independently (no chain dependency)
 */

import type { Entity } from "./Entity.js";
import type { ClassificationOutput } from "./ClassificationOutput.js";

/**
 * Context provided to classification plugins during evaluation.
 */
export interface ClassificationContext {
    /**
     * Read-only configuration for the plugin.
     * Domain-specific settings passed during registration.
     */
    readonly config: Readonly<Record<string, unknown>>;

    /**
     * Logger for the plugin.
     */
    readonly logger: PluginLogger;

    /**
     * Unique trace ID for this processing cycle.
     * Use for correlation in logs and events.
     */
    readonly traceId: string;
}

/**
 * Logger interface for plugins.
 */
export interface PluginLogger {
    debug(message: string, data?: Record<string, unknown>): void;
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Classification Plugin interface.
 *
 * Plugins are stateless evaluators. They receive a message (entity)
 * and context, and return a classification output.
 *
 * Rules:
 * - Must not mutate the message
 * - Must not execute actions
 * - Returns ClassificationOutput or null (no match)
 * - All plugins run; engine selects highest confidence
 *
 * @example
 * ```typescript
 * // Simple regex-based classifier
 * const politicalSpamClassifier: ClassificationPlugin = {
 *     id: "political-spam-regex",
 *     classify(message, context) {
 *         const content = message.content as string;
 *         if (/donate|contribute|campaign/i.test(content)) {
 *             return { type: "political_spam", confidence: 1.0 };
 *         }
 *         return null;
 *     }
 * };
 *
 * // AI-powered classifier
 * const aiClassifier: ClassificationPlugin = {
 *     id: "ai-classifier",
 *     async classify(message, context) {
 *         const result = await callAIModel(message.content);
 *         return {
 *             type: result.type,
 *             confidence: result.confidence,
 *             tags: result.tags
 *         };
 *     }
 * };
 * ```
 */
export interface ClassificationPlugin {
    /**
     * Unique identifier for this plugin.
     * Used for logging, debugging, and configuration.
     */
    readonly id: string;

    /**
     * Optional human-readable name.
     */
    readonly name?: string;

    /**
     * Optional description of what this plugin does.
     */
    readonly description?: string;

    /**
     * Evaluate a message and return a classification output.
     *
     * @param message - The message to evaluate (read-only entity)
     * @param context - Evaluation context (config, logger, traceId)
     * @returns ClassificationOutput if matched, or null if no opinion
     */
    classify(
        message: Entity<object>,
        context: ClassificationContext
    ): Promise<ClassificationOutput | null> | ClassificationOutput | null;
}

/**
 * Type guard to check if an object is a ClassificationPlugin.
 *
 * @param obj - The object to check
 * @returns True if the object implements ClassificationPlugin
 */
export function isClassificationPlugin(obj: unknown): obj is ClassificationPlugin {
    return (
        typeof obj === "object" &&
        obj !== null &&
        "id" in obj &&
        typeof (obj as ClassificationPlugin).id === "string" &&
        "classify" in obj &&
        typeof (obj as ClassificationPlugin).classify === "function"
    );
}
