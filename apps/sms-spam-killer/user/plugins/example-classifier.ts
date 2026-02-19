/**
 * Example User Classifier Plugin
 * ===============================
 *
 * This is an example TypeScript classifier plugin that you can use as a template
 * for creating your own custom classifiers.
 *
 * To create your own plugin:
 * 1. Copy this file and rename it (e.g., my-classifier.ts)
 * 2. Update the id, name, and description
 * 3. Implement your classification logic in the classify() method
 * 4. Rebuild and restart the app
 *
 * The plugin will be automatically loaded from the user/plugins/ directory.
 *
 * @example
 * To classify messages from specific senders as "known":
 * ```typescript
 * const knownSenders = ['+1234567890', 'friend@email.com'];
 * if (knownSenders.includes(sender)) {
 *     return { type: 'known', confidence: 1.0 };
 * }
 * ```
 */

import type {
    ClassificationPlugin,
    ClassificationOutput,
    ClassificationContext,
    Entity,
} from "@tagrouter/engine";

/**
 * Interface for SMS message metadata
 */
interface SMSMetadata {
    sender?: string;
    timestamp?: Date;
    isFromMe?: boolean;
    service?: string;
}

/**
 * Example classifier that detects messages from known contacts.
 *
 * Customize this by adding your own sender whitelist or classification logic.
 */
export const exampleClassifier: ClassificationPlugin = {
    id          : "user-example-classifier",
    name        : "Example User Classifier",
    description : "Example plugin - detects messages from whitelisted senders",

    /**
     * Classify an incoming message.
     *
     * @param message - The message entity to classify
     * @param context - Classification context with logger and config
     * @returns Classification output, or null if this classifier doesn't match
     */
    classify(
        message: Entity<SMSMetadata>,
        context: ClassificationContext
    ): ClassificationOutput | null {
        const { logger } = context;
        const sender = message.metadata?.sender ?? "";

        // =====================================================================
        // CUSTOMIZE THIS SECTION
        // =====================================================================

        // Example: Whitelist of known senders (add your contacts here)
        const knownSenders: string[] = [
            // '+1234567890',      // Example phone number
            // 'friend@email.com', // Example email
        ];

        // Example: Patterns for messages you want to always allow
        const safePatterns: RegExp[] = [
            // /^Your verification code is/i,  // Example: verification codes
            // /^Your order #/i,                // Example: order confirmations
        ];

        // =====================================================================
        // CLASSIFICATION LOGIC
        // =====================================================================

        // Check if sender is in the whitelist
        if (knownSenders.includes(sender)) {
            logger.debug("Message from known sender", { sender });
            return {
                type       : "known",
                confidence : 1.0,
                tags       : ["whitelisted", "user-defined"],
            };
        }

        // Check if message matches safe patterns
        for (const pattern of safePatterns) {
            if (pattern.test(message.content)) {
                logger.debug("Message matches safe pattern", {
                    pattern: pattern.source
                });
                return {
                    type       : "safe",
                    confidence : 0.95,
                    tags       : ["pattern-match", "user-defined"],
                };
            }
        }

        // Return null to let other classifiers handle the message
        return null;
    },
};

// Default export for the plugin loader
export default exampleClassifier;
