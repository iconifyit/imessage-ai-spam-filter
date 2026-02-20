/**
 * Action Plugin Contract
 *
 * Plugins that execute side effects based on classification results.
 * Actions self-declare which message types they handle via bindings.
 *
 * Design principles:
 * - Idempotent: Safe to execute multiple times with same result
 * - Declarative: Actions declare their bindings, engine decides when to run
 * - Focused: Actions only execute, they do not classify
 */

import type { Entity } from "./Entity.js";
import type { ClassificationOutput, MessageType } from "./ClassificationOutput.js";
import type { PluginLogger } from "./ClassificationPlugin.js";

/**
 * Binding configuration for an action.
 * Specifies the minimum confidence required to execute for a given type.
 */
export interface ActionBinding {
    /**
     * Minimum confidence required to execute this action.
     * Default is 0.0 if omitted (always execute when type matches).
     */
    readonly minConfidence?: number;
}

/**
 * Context provided to action plugins during execution.
 */
export interface ActionContext {
    /**
     * The message being acted upon (read-only).
     */
    readonly message: Entity<object>;

    /**
     * The classification that triggered this action.
     */
    readonly classification: ClassificationOutput;

    /**
     * Read-only configuration for the plugin.
     */
    readonly config: Readonly<Record<string, unknown>>;

    /**
     * Logger for the plugin.
     */
    readonly logger: PluginLogger;

    /**
     * Unique trace ID for this processing cycle.
     */
    readonly traceId: string;
}

/**
 * Result of executing an action.
 */
export interface ActionResult {
    /**
     * Identifier of the action that was executed.
     */
    readonly actionId: string;

    /**
     * Whether the action succeeded.
     */
    readonly success: boolean;

    /**
     * Error message if the action failed.
     */
    readonly error?: string;

    /**
     * Optional output data from the action.
     */
    readonly data?: Record<string, unknown>;
}

/**
 * Action Plugin interface.
 *
 * Actions self-declare which message types they handle via the `bindings`
 * property. The engine checks bindings and executes actions when:
 * 1. The binding includes the classified message type
 * 2. The classification confidence >= binding's minConfidence
 *
 * Rules:
 * - Must be idempotent
 * - Must not classify messages
 * - May emit events
 * - Multiple actions per type are supported
 *
 * @example
 * ```typescript
 * const deleteSpamAction: ActionPlugin = {
 *     id: "delete-spam",
 *     bindings: {
 *         "spam": { minConfidence: 0.9 },
 *         "political_spam": { minConfidence: 0.8 }
 *     },
 *     async handle(context) {
 *         await deleteMessage(context.message.id);
 *         return { actionId: this.id, success: true };
 *     }
 * };
 *
 * // Action that runs for any spam type with no confidence threshold
 * const logSpamAction: ActionPlugin = {
 *     id: "log-spam",
 *     bindings: {
 *         "spam": {},
 *         "political_spam": {},
 *         "marketing": { minConfidence: 0.7 }
 *     },
 *     async handle(context) {
 *         console.log(`Spam detected: ${context.message.id}`);
 *         return { actionId: this.id, success: true };
 *     }
 * };
 * ```
 */
export interface ActionPlugin {
    /**
     * Unique identifier for this action.
     */
    readonly id: string;

    /**
     * Optional human-readable name.
     */
    readonly name?: string;

    /**
     * Optional description of what this action does.
     */
    readonly description?: string;

    /**
     * Bindings that declare which message types this action handles.
     * Maps MessageType -> ActionBinding (with optional minConfidence).
     *
     * The engine will execute this action when:
     * - classification.type exists in bindings
     * - classification.confidence >= binding.minConfidence (default 0.0)
     */
    readonly bindings: Record<MessageType, ActionBinding>;

    /**
     * Execute the action.
     *
     * Actions must be idempotent - safe to execute multiple times
     * with the same message and classification.
     *
     * @param context - Execution context (message, classification, config, etc.)
     * @returns Result of the action execution
     */
    handle(context: ActionContext): Promise<ActionResult>;
}

/**
 * Type guard to check if an object is an ActionPlugin.
 *
 * @param obj - The object to check
 * @returns True if the object implements ActionPlugin
 */
export function isActionPlugin(obj: unknown): obj is ActionPlugin {
    return (
        typeof obj === "object" &&
        obj !== null &&
        "id" in obj &&
        typeof (obj as ActionPlugin).id === "string" &&
        "bindings" in obj &&
        typeof (obj as ActionPlugin).bindings === "object" &&
        "handle" in obj &&
        typeof (obj as ActionPlugin).handle === "function"
    );
}

/**
 * Check if an action should execute for a given classification.
 *
 * @param action - The action plugin
 * @param classification - The classification output
 * @returns True if the action should execute
 */
export function shouldActionExecute(
    action: ActionPlugin,
    classification: ClassificationOutput
): boolean {
    const binding = action.bindings[classification.type];

    if (!binding) {
        return false;
    }

    const confidence      = classification.confidence ?? 1.0;
    const minConfidence   = binding.minConfidence ?? 0.0;

    return confidence >= minConfidence;
}
