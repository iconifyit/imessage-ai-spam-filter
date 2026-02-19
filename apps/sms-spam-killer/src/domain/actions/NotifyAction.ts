/**
 * @fileoverview Notify Action Plugin
 *
 * Implements the ActionPlugin contract to log notifications
 * when spam is detected.
 *
 * @module domain/actions/NotifyAction
 */

import type {
    ActionPlugin,
    ActionResult,
    ActionContext,
    ActionBinding,
    MessageType,
} from "@tagrouter/engine";
import type { SMSMessage } from "../entities/SMSMessage.js";

/**
 * Configuration for NotifyActionPlugin
 */
export interface NotifyActionPluginConfig {
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
}

/**
 * Default bindings for notify action.
 * Notifies for spam, promotional, and suspicious messages with lower threshold.
 */
const DEFAULT_BINDINGS: Record<MessageType, ActionBinding> = {
    spam           : { minConfidence: 0.7 },
    promotional    : { minConfidence: 0.7 },
    suspicious     : { minConfidence: 0.7 },
    political_spam : { minConfidence: 0.7 },
    scam           : { minConfidence: 0.7 },
};

/**
 * Notify Action Plugin
 *
 * Logs a notification to the console when suspicious messages are detected.
 *
 * @example
 * ```typescript
 * const action = new NotifyActionPlugin({
 *     bindings: {
 *         spam: { minConfidence: 0.7 },
 *         suspicious: { minConfidence: 0.6 },
 *     },
 * });
 *
 * // Engine will call handle() when bindings match
 * const result = await action.handle(context);
 * ```
 */
export class NotifyActionPlugin implements ActionPlugin {
    readonly id          = "notify-spam";
    readonly name        = "Notify Spam Detection";
    readonly description = "Logs a console notification when spam is detected";
    readonly bindings: Record<MessageType, ActionBinding>;

    private titleTemplate: string;

    constructor(config: NotifyActionPluginConfig = {}) {
        this.bindings      = config.bindings ?? DEFAULT_BINDINGS;
        this.titleTemplate = config.titleTemplate ?? "{{type}} Detected";
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

        // Log notification to console instead of showing macOS notification
        console.log(`\n🚨 ${title}`);
        console.log(`   ${subtitle}`);
        console.log(`   ${notificationMessage.replace(/\n/g, "\n   ")}`);

        logger.info("Spam notification logged", {
            messageId: message.id,
            sender,
            type     : classification.type,
            title,
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
