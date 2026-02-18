/**
 * @fileoverview Notify Spam Action
 *
 * Implements the Action contract to show notifications
 * when spam is detected.
 *
 * @module domain/actions/NotifySpamAction
 */

import type {
    Action,
    ActionResult,
    ActionContext,
    Classification,
} from "@tagrouter/engine";
import { showNotification } from "../../adapters/imessage/services/applescript.js";
import type { SMSMessage } from "../entities/SMSMessage.js";

/**
 * Configuration for NotifySpamAction
 */
export interface NotifySpamActionConfig {
    /**
     * Classification types that trigger notification.
     * Defaults to ["spam", "promotional", "suspicious"].
     */
    readonly triggerTypes?: string[];

    /**
     * Minimum confidence required to trigger notification.
     * Defaults to 0.7 (70%).
     */
    readonly minConfidence?: number;

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
 * Notify Spam Action
 *
 * Shows a macOS notification when suspicious messages are detected.
 *
 * @example
 * ```typescript
 * const action = new NotifySpamAction({
 *     triggerTypes: ["spam", "suspicious"],
 *     minConfidence: 0.7,
 *     sound: "Basso",
 * });
 *
 * if (action.shouldExecute(classification)) {
 *     await action.execute(context);
 * }
 * ```
 */
export class NotifySpamAction implements Action {
    readonly id = "notify-spam";
    readonly name = "Notify Spam Detection";
    readonly description = "Shows a notification when spam is detected";

    private config: Required<Omit<NotifySpamActionConfig, "sound">> & { sound?: string };

    constructor(config: NotifySpamActionConfig = {}) {
        this.config = {
            triggerTypes : config.triggerTypes ?? ["spam", "promotional", "suspicious"],
            minConfidence: config.minConfidence ?? 0.7,
            titleTemplate: config.titleTemplate ?? "{{type}} Detected",
            sound        : config.sound,
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
     * Execute the notification action.
     *
     * @param context - Execution context with entity and classification
     * @returns Result of the action execution
     */
    async execute(context: ActionContext): Promise<ActionResult> {
        const { entity, classification } = context;

        // Cast to SMSMessage to access metadata
        const smsEntity = entity as unknown as SMSMessage;
        const sender = smsEntity.metadata?.sender ?? "Unknown";

        // Build notification title
        const title = this.config.titleTemplate.replace(
            "{{type}}",
            this.formatType(classification.type)
        );

        // Build notification message
        const message = `From: ${sender}\n${this.truncate(entity.content, 100)}`;

        // Build subtitle with confidence
        const subtitle = `Confidence: ${Math.round(classification.confidence * 100)}%`;

        context.logger.info("Showing spam notification", {
            entityId: entity.id,
            sender,
            type    : classification.type,
            title,
        });

        try {
            const result = await showNotification(
                title,
                message,
                subtitle,
                this.config.sound
            );

            if (result.success) {
                context.logger.debug("Notification shown successfully", {
                    entityId: entity.id,
                });

                return {
                    actionId: this.id,
                    success : true,
                    data    : {
                        title,
                        message,
                        subtitle,
                    },
                };
            }
            else {
                context.logger.warn("Failed to show notification", {
                    entityId: entity.id,
                    error   : result.error,
                });

                return {
                    actionId: this.id,
                    success : false,
                    error   : result.error || "Unknown notification error",
                };
            }
        }
        catch (error) {
            context.logger.error("Notification action threw error", {
                entityId: entity.id,
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
