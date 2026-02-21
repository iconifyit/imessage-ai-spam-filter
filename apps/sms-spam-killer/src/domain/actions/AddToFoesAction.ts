/**
 * @fileoverview Add To Foes Action Plugin
 *
 * Implements the ActionPlugin contract to automatically append senders
 * to the foes list when they are classified as spam with high confidence.
 *
 * This creates a learning feedback loop: the first message from a spammer
 * costs an AI API call, but subsequent messages from the same sender are
 * caught instantly by the SenderListClassifier — for free.
 *
 * @see {@link ../../docs/adr/ADR-002-sender-lists.md} for design rationale
 * @module domain/actions/AddToFoesAction
 */

import { readFileSync, appendFileSync, existsSync } from "fs";

import type {
    ActionPlugin,
    ActionResult,
    ActionContext,
    ActionBinding,
    MessageType,
} from "@tagrouter/engine";

import type { SMSMessage } from "../entities/SMSMessage.js";
import { parseListFile } from "../utils/senderList.js";

/**
 * Configuration for AddToFoesActionPlugin.
 */
export interface AddToFoesActionPluginConfig {
    /**
     * Absolute path to the foes.txt file.
     * Sender will be appended to this file.
     */
    readonly foesFile: string;

    /**
     * Bindings that map message types to minimum confidence thresholds.
     * Defaults to spam and scam at 0.9 confidence.
     */
    readonly bindings?: Record<MessageType, ActionBinding>;
}

/**
 * Default bindings for add-to-foes action.
 * Only adds senders for high-confidence spam/scam classifications.
 */
const DEFAULT_BINDINGS: Record<MessageType, ActionBinding> = {
    scam : { minConfidence: 0.9 },
    spam : { minConfidence: 0.9 },
};

/**
 * Add To Foes Action Plugin
 *
 * When a message is classified as spam or scam with high confidence,
 * this action appends the sender to foes.txt. The action is idempotent —
 * if the sender is already in the foes list, it's a no-op.
 *
 * On the next run, the SenderListClassifier will catch this sender
 * immediately at confidence 1.0, skipping the AI call entirely.
 *
 * @example
 * ```typescript
 * const action = new AddToFoesActionPlugin({
 *     foesFile: "/path/to/foes.txt",
 *     bindings: {
 *         spam: { minConfidence: 0.9 },
 *         scam: { minConfidence: 0.85 },
 *     },
 * });
 *
 * // Engine will call handle() when bindings match
 * const result = await action.handle(context);
 * console.log(result.success ? "Added to foes" : result.error);
 * ```
 */
export class AddToFoesActionPlugin implements ActionPlugin {
    readonly id          = "add-to-foes";
    readonly name        = "Add Sender to Foes List";
    readonly description = "Appends spam/scam senders to foes.txt for future instant classification";
    readonly bindings: Record<MessageType, ActionBinding>;

    private foesFile: string;

    /**
     * Create a new AddToFoesActionPlugin.
     *
     * @param config - Configuration with foes file path and optional bindings
     */
    constructor(config: AddToFoesActionPluginConfig) {
        this.foesFile = config.foesFile;
        this.bindings = config.bindings ?? DEFAULT_BINDINGS;
    }

    /**
     * Execute the add-to-foes action.
     *
     * Checks if the sender is already in the foes list to avoid duplicates.
     * If not present, appends the sender as a new line in foes.txt with
     * a comment indicating when and why it was added.
     *
     * @param context - Execution context with message, classification, config, logger
     * @returns Result of the action execution
     */
    async handle(context: ActionContext): Promise<ActionResult> {
        const { message, classification, logger } = context;

        const smsMessage = message as unknown as SMSMessage;
        const sender     = smsMessage.metadata?.sender;

        if (!sender) {
            logger.warn("Cannot add to foes: no sender in message metadata", {
                messageId: message.id,
            });

            return {
                actionId : this.id,
                success  : false,
                error    : "No sender in message metadata",
            };
        }

        // Check if sender is already in foes list to avoid duplicates
        if (this.isSenderInFoesList(sender)) {
            logger.debug("Sender already in foes list, skipping", {
                messageId : message.id,
                sender,
            });

            return {
                actionId : this.id,
                success  : true,
                data     : {
                    alreadyPresent : true,
                    sender,
                },
            };
        }

        try {
            // Append sender to foes.txt with metadata comment
            const timestamp = new Date().toISOString();
            const entry     = `\n# Auto-added ${timestamp} (${classification.type}, confidence: ${classification.confidence})\n${sender}\n`;

            appendFileSync(this.foesFile, entry, "utf-8");

            logger.info("Added sender to foes list", {
                messageId  : message.id,
                sender,
                type       : classification.type,
                confidence : classification.confidence,
            });

            return {
                actionId : this.id,
                success  : true,
                data     : {
                    alreadyPresent : false,
                    sender,
                },
            };
        }
        catch (error) {
            logger.error("Failed to add sender to foes list", {
                messageId : message.id,
                sender,
                error     : error instanceof Error ? error.message : String(error),
            });

            return {
                actionId : this.id,
                success  : false,
                error    : error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Check if a sender is already present in the foes list.
     *
     * Reads the foes file fresh each time to account for entries
     * added by other action invocations in the same batch.
     *
     * @param sender - The sender identifier to check
     * @returns True if the sender is already in the foes list
     */
    private isSenderInFoesList(sender: string): boolean {
        if (!existsSync(this.foesFile)) {
            return false;
        }

        try {
            const content = readFileSync(this.foesFile, "utf-8");
            const entries = content
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line && !line.startsWith("#"))
                .map((line) => line.toLowerCase());

            return entries.includes(sender.toLowerCase());
        }
        catch {
            return false;
        }
    }
}
