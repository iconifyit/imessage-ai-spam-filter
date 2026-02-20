/**
 * @fileoverview Delete Action Plugin
 *
 * Implements the ActionPlugin contract to delete conversations
 * classified as spam.
 *
 * @module domain/actions/DeleteAction
 */

import type {
    ActionPlugin,
    ActionResult,
    ActionContext,
    ActionBinding,
    MessageType,
} from "@tagrouter/engine";
import { deleteConversationBySender } from "../../adapters/imessage/services/applescript.js";
import type { SMSMessage } from "../entities/SMSMessage.js";

/**
 * Configuration for DeleteActionPlugin
 */
export interface DeleteActionPluginConfig {
    /**
     * Bindings that map message types to minimum confidence thresholds.
     * Example: { "spam": { minConfidence: 0.9 }, "scam": { minConfidence: 0.85 } }
     */
    readonly bindings?: Record<MessageType, ActionBinding>;

    /**
     * If true, perform a dry run (don't actually delete).
     * Defaults to false.
     */
    readonly dryRun?: boolean;
}

/**
 * Default bindings for delete action.
 * Only deletes spam and scam messages with high confidence.
 */
const DEFAULT_BINDINGS: Record<MessageType, ActionBinding> = {
    spam: { minConfidence: 0.9 },
    scam: { minConfidence: 0.9 },
};

/**
 * Delete Action Plugin
 *
 * Deletes conversations that are classified as spam with high confidence.
 * Uses AppleScript to interact with Messages.app.
 *
 * @example
 * ```typescript
 * const action = new DeleteActionPlugin({
 *     bindings: {
 *         spam: { minConfidence: 0.9 },
 *         political_spam: { minConfidence: 0.85 },
 *     },
 *     dryRun: false,
 * });
 *
 * // Engine will call handle() when bindings match
 * const result = await action.handle(context);
 * console.log(result.success ? "Deleted" : result.error);
 * ```
 */
export class DeleteActionPlugin implements ActionPlugin {
    readonly id          = "delete-spam";
    readonly name        = "Delete Spam Messages";
    readonly description = "Deletes conversations classified as spam";
    readonly bindings: Record<MessageType, ActionBinding>;

    private dryRun: boolean;

    constructor(config: DeleteActionPluginConfig = {}) {
        this.bindings = config.bindings ?? DEFAULT_BINDINGS;
        this.dryRun   = config.dryRun ?? false;
    }

    /**
     * Execute the delete action.
     *
     * @param context - Execution context with message, classification, config, logger
     * @returns Result of the action execution
     */
    async handle(context: ActionContext): Promise<ActionResult> {
        const { message, classification, logger } = context;

        const smsMessage = message as unknown as SMSMessage;
        const sender = smsMessage.metadata?.sender;

        if (!sender) {
            logger.warn("Cannot delete: no sender in message metadata", {
                messageId: message.id,
            });

            return {
                actionId: this.id,
                success : false,
                error   : "No sender in message metadata",
            };
        }

        logger.info("Deleting spam conversation", {
            messageId : message.id,
            sender,
            type      : classification.type,
            confidence: classification.confidence,
            dryRun    : this.dryRun,
        });

        if (this.dryRun) {
            logger.info("DRY RUN: Would delete conversation", { sender });

            return {
                actionId: this.id,
                success : true,
                data    : {
                    dryRun     : true,
                    sender,
                    wouldDelete: true,
                },
            };
        }

        try {
            const result = await deleteConversationBySender(sender);

            if (result.success) {
                logger.info("Successfully deleted conversation", {
                    messageId: message.id,
                    sender,
                    output   : result.output,
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

            logger.error("Failed to delete conversation", {
                messageId: message.id,
                sender,
                error    : result.error,
            });

            return {
                actionId: this.id,
                success : false,
                error   : result.error || "Unknown AppleScript error",
            };
        }
        catch (error) {
            logger.error("Delete action threw error", {
                messageId: message.id,
                sender,
                error    : error instanceof Error ? error.message : String(error),
            });

            return {
                actionId: this.id,
                success : false,
                error   : error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Enable or disable dry run mode.
     */
    setDryRun(dryRun: boolean): void {
        this.dryRun = dryRun;
    }
}
