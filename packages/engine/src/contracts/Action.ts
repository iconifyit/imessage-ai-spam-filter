/**
 * Action Contract
 *
 * Actions are commands executed after classification.
 * They perform side effects (delete, notify, label, etc.).
 *
 * Design principles:
 * - Idempotent: Safe to execute multiple times with same result
 * - Self-selecting: Actions decide if they should run via shouldExecute()
 * - Context-aware: Receive full context (entity, classification, config)
 */

import type { Entity } from "./Entity.js";
import type { Classification } from "./Classification.js";

/**
 * Result of executing an action.
 */
export interface ActionResult {
    /** Identifier of the action that was executed */
    readonly actionId: string;

    /** Whether the action succeeded */
    readonly success: boolean;

    /** Error message if the action failed */
    readonly error?: string;

    /** Optional output data */
    readonly data?: Record<string, unknown>;
}

/**
 * Context provided to actions during execution.
 */
export interface ActionContext {
    /** The entity being acted upon (read-only) */
    readonly entity: Entity<object>;

    /** All classifications from the classifier chain */
    readonly classifications: readonly Classification[];

    /** The final/primary classification */
    readonly classification: Classification;

    /** Read-only configuration */
    readonly config: Readonly<Record<string, unknown>>;

    /** Logger for the action */
    readonly logger: ActionLogger;
}

/**
 * Logger interface for actions.
 */
export interface ActionLogger {
    debug(message: string, data?: Record<string, unknown>): void;
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Action interface.
 *
 * Actions are idempotent commands that execute side effects
 * based on classification results.
 *
 * @example
 * ```typescript
 * const deleteSpamAction: Action = {
 *     id: "delete-spam",
 *     name: "Delete Spam Messages",
 *
 *     shouldExecute(classification) {
 *         return classification.type === "spam" && classification.confidence > 0.9;
 *     },
 *
 *     async execute(context) {
 *         await deleteMessage(context.entity.id);
 *         return { actionId: this.id, success: true };
 *     }
 * };
 * ```
 */
export interface Action {
    /** Unique identifier for this action */
    readonly id: string;

    /** Human-readable name */
    readonly name: string;

    /** Optional description */
    readonly description?: string;

    /**
     * Determine if this action should execute for the given classification.
     *
     * @param classification - The classification result
     * @returns true if this action should execute
     */
    shouldExecute(classification: Classification): boolean;

    /**
     * Execute the action.
     *
     * Actions must be idempotent - safe to execute multiple times
     * with the same entity and classification.
     *
     * @param context - Execution context (entity, classification, config, etc.)
     * @returns Result of the action execution
     */
    execute(context: ActionContext): Promise<ActionResult>;
}

/**
 * Action that triggers on specific classification types.
 * Convenience type for common pattern of "if type X, do action Y".
 */
export interface TypeMappedAction extends Action {
    /** Classification types that trigger this action */
    readonly triggerTypes: readonly string[];
}

/**
 * Type guard to check if an action is type-mapped.
 */
export function isTypeMappedAction(action: Action): action is TypeMappedAction {
    return "triggerTypes" in action && Array.isArray((action as TypeMappedAction).triggerTypes);
}
