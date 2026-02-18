/**
 * @fileoverview Delete Spam Action
 *
 * Implements the Action contract to delete conversations
 * classified as spam.
 *
 * @module domain/actions/DeleteSpamAction
 */

import type {
    Action,
    ActionResult,
    ActionContext,
    Classification,
} from "@tagrouter/engine";
import { deleteConversationBySender } from "../../adapters/imessage/services/applescript.js";
import type { SMSMessage } from "../entities/SMSMessage.js";

/**
 * Configuration for DeleteSpamAction
 */
export interface DeleteSpamActionConfig {
    /**
     * Classification types that trigger deletion.
     * Defaults to ["spam"].
     */
    readonly triggerTypes?: string[];

    /**
     * Minimum confidence required to trigger deletion.
     * Defaults to 0.9 (90%).
     */
    readonly minConfidence?: number;

    /**
     * If true, perform a dry run (don't actually delete).
     * Defaults to false.
     */
    readonly dryRun?: boolean;
}

/**
 * Delete Spam Action
 *
 * Deletes conversations that are classified as spam with high confidence.
 * Uses AppleScript to interact with Messages.app.
 *
 * @example
 * ```typescript
 * const action = new DeleteSpamAction({
 *     triggerTypes: ["spam"],
 *     minConfidence: 0.9,
 * });
 *
 * if (action.shouldExecute(classification)) {
 *     const result = await action.execute(context);
 *     console.log(result.success ? "Deleted" : result.error);
 * }
 * ```
 */
export class DeleteSpamAction implements Action {
    readonly id = "delete-spam";
    readonly name = "Delete Spam Messages";
    readonly description = "Deletes conversations classified as spam";

    private config: Required<DeleteSpamActionConfig>;

    constructor(config: DeleteSpamActionConfig = {}) {
        this.config = {
            triggerTypes : config.triggerTypes ?? ["spam"],
            minConfidence: config.minConfidence ?? 0.9,
            dryRun       : config.dryRun ?? false,
        };
    }

    /**
     * Determine if this action should execute for the given classification.
     *
     * @param classification - The classification result
     * @returns true if this action should execute
     */
    shouldExecute(classification: Classification): boolean {
        // Check if classification type matches any trigger type
        const typeMatches = this.config.triggerTypes.includes(classification.type);

        // Check if confidence meets minimum threshold
        const confidenceMet = classification.confidence >= this.config.minConfidence;

        return typeMatches && confidenceMet;
    }

    /**
     * Execute the delete action.
     *
     * @param context - Execution context with entity and classification
     * @returns Result of the action execution
     */
    async execute(context: ActionContext): Promise<ActionResult> {
        const { entity, classification } = context;

        // Cast to SMSMessage to access metadata
        const smsEntity = entity as unknown as SMSMessage;
        const sender = smsEntity.metadata?.sender;

        if (!sender) {
            context.logger.warn("Cannot delete: no sender in message metadata", {
                entityId: entity.id,
            });

            return {
                actionId: this.id,
                success : false,
                error   : "No sender in message metadata",
            };
        }

        context.logger.info("Deleting spam conversation", {
            entityId  : entity.id,
            sender,
            type      : classification.type,
            confidence: classification.confidence,
            dryRun    : this.config.dryRun,
        });

        // Dry run - don't actually delete
        if (this.config.dryRun) {
            context.logger.info("DRY RUN: Would delete conversation", { sender });

            return {
                actionId: this.id,
                success : true,
                data    : {
                    dryRun: true,
                    sender,
                    wouldDelete: true,
                },
            };
        }

        try {
            // Call AppleScript to delete the conversation
            const result = await deleteConversationBySender(sender);

            if (result.success) {
                context.logger.info("Successfully deleted conversation", {
                    entityId: entity.id,
                    sender,
                    output  : result.output,
                });

                return {
                    actionId: this.id,
                    success : true,
                    data    : {
                        sender,
                        output: result.output,
                    },
                };
            }
            else {
                context.logger.error("Failed to delete conversation", {
                    entityId: entity.id,
                    sender,
                    error   : result.error,
                });

                return {
                    actionId: this.id,
                    success : false,
                    error   : result.error || "Unknown AppleScript error",
                };
            }
        }
        catch (error) {
            context.logger.error("Delete action threw error", {
                entityId: entity.id,
                sender,
                error   : error instanceof Error ? error.message : String(error),
            });

            return {
                actionId: this.id,
                success : false,
                error   : error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Update the minimum confidence threshold.
     */
    setMinConfidence(confidence: number): void {
        this.config = { ...this.config, minConfidence: confidence };
    }

    /**
     * Enable or disable dry run mode.
     */
    setDryRun(dryRun: boolean): void {
        this.config = { ...this.config, dryRun };
    }
}
