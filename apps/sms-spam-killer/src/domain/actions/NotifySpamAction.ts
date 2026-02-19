/**
 * @fileoverview Notify Spam Action Plugin
 *
 * Implements the ActionPlugin contract to show notifications
 * when spam is detected.
 *
 * @module domain/actions/NotifySpamAction
 */

import type {
    ActionPlugin,
    ActionResult,
    ActionContext,
    ActionBinding,
    MessageType,
} from "@tagrouter/engine";
import { showNotification } from "../../adapters/imessage/services/applescript.js";
import type { SMSMessage } from "../entities/SMSMessage.js";

/**
 * Configuration for NotifySpamActionPlugin
 */
export interface NotifySpamActionPluginConfig {
    /**
     * Bindings that map message types to minimum confidence thresholds.
     * Example: { "spam": { minConfidence: 0.7 }, "suspicious": { minConfidence: 0.6 } }
     */
    readonly bindings?: Record<MessageType, ActionBinding>;

    /**
     * Notification title template.
     * Use {{type}} for classification type.
     * Defaults to "{{type}} Detected".
     */
    readonly titleTemplate?: string;

    /**
     * Optional sound to play (e.g., "default", "Basso").
     */
    readonly sound?: string;
}

/**
 * Default bindings for notify action.
 * Notifies for spam, promotional, and suspicious messages with lower threshold.
 */
const DEFAULT_BINDINGS: Record<MessageType, ActionBinding> = {
    spam              : { minConfidence: 0.7 },
    promotional       : { minConfidence: 0.7 },
    suspicious        : { minConfidence: 0.7 },
    political_spam    : { minConfidence: 0.7 },
    scam              : { minConfidence: 0.7 },
};

/**
 * Notify Spam Action Plugin
 *
 * Shows a macOS notification when suspicious messages are detected.
 *
 * @example
 * ```typescript
 * const action = new NotifySpamActionPlugin({
 *     bindings: {
 *         spam: { minConfidence: 0.7 },
 *         suspicious: { minConfidence: 0.6 },
 *     },
 *     sound: "Basso",
 * });
 *
 * // Engine will call handle() when bindings match
 * const result = await action.handle(context);
 * ```
 */
export class NotifySpamActionPlugin implements ActionPlugin {
    readonly id          = "notify-spam";
    readonly name        = "Notify Spam Detection";
    readonly description = "Shows a notification when spam is detected";
    readonly bindings: Record<MessageType, ActionBinding>;

    private titleTemplate: string;
    private sound?: string;

    constructor(config: NotifySpamActionPluginConfig = {}) {
        this.bindings      = config.bindings ?? DEFAULT_BINDINGS;
        this.titleTemplate = config.titleTemplate ?? "{{type}} Detected";
        this.sound         = config.sound;
    }

    /**
     * Execute the notification action.
     *
     * @param context - Execution context with message, classification, config, logger
     * @returns Result of the action execution
     */
    async handle(context: ActionContext): Promise<ActionResult> {
        const { message, classification, logger } = context;

        const smsMessage = message as unknown as SMSMessage;
        const sender = smsMessage.metadata?.sender ?? "Unknown";

        const title = this.titleTemplate.replace(
            "{{type}}",
            this.formatType(classification.type)
        );

        const notificationMessage = `From: ${sender}\n${this.truncate(message.content, 100)}`;

        const subtitle = `Confidence: ${Math.round((classification.confidence ?? 1) * 100)}%`;

        logger.info("Showing spam notification", {
            messageId: message.id,
            sender,
            type     : classification.type,
            title,
        });

        try {
            const result = await showNotification(
                title,
                notificationMessage,
                subtitle,
                this.sound
            );

            if (result.success) {
                logger.debug("Notification shown successfully", {
                    messageId: message.id,
                });

                return {
                    actionId: this.id,
                    success : true,
                    data    : {
                        title,
                        message: notificationMessage,
                        subtitle,
                    },
                };
            }

            logger.warn("Failed to show notification", {
                messageId: message.id,
                error    : result.error,
            });

            return {
                actionId: this.id,
                success : false,
                error   : result.error || "Unknown notification error",
            };
        }
        catch (error) {
            logger.error("Notification action threw error", {
                messageId: message.id,
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
     * Format classification type for display.
     * Capitalizes first letter.
     */
    private formatType(type: string): string {
        return type.charAt(0).toUpperCase() + type.slice(1);
    }

    /**
     * Truncate string to maximum length.
     */
    private truncate(str: string, maxLength: number): string {
        if (str.length <= maxLength) {
            return str;
        }
        return str.slice(0, maxLength - 3) + "...";
    }
}
