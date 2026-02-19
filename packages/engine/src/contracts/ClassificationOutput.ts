/**
 * Classification Output
 *
 * The result of a classification plugin evaluating a message.
 * This is the contract boundary between classification and action.
 *
 * Design principles:
 * - Simple: MessageType is just a string
 * - Immutable: Treat as read-only after creation
 * - Minimal: Only essential fields, tags are metadata only
 */

/**
 * MessageType is a simple string identifier.
 * Examples: "spam", "political_spam", "marketing", "personal", "transactional"
 */
export type MessageType = string;

/**
 * Output from a ClassificationPlugin.
 *
 * @example
 * ```typescript
 * // Hard rule with full confidence
 * { type: "political_spam", confidence: 1.0 }
 *
 * // AI classifier with probabilistic confidence
 * { type: "marketing", confidence: 0.85, tags: ["promotional", "newsletter"] }
 *
 * // Weak heuristic
 * { type: "spam", confidence: 0.5, tags: ["short-code"] }
 * ```
 */
export interface ClassificationOutput {
    /**
     * The message type (routing key).
     * This is the primary classification result used for action dispatch.
     */
    readonly type: MessageType;

    /**
     * Optional metadata tags.
     * Informational only - NOT used for routing.
     * Useful for logging, debugging, or downstream processing.
     */
    readonly tags?: readonly string[];

    /**
     * Confidence score between 0.0 and 1.0.
     * Default is 1.0 if omitted.
     *
     * Used to resolve conflicts when multiple classifiers match:
     * - 1.0 = hard rule (regex match, explicit pattern)
     * - 0.5-0.9 = probabilistic (AI classifier)
     * - < 0.5 = weak heuristic
     */
    readonly confidence?: number;
}

/**
 * Factory function to create a ClassificationOutput.
 * Ensures the object is frozen (immutable).
 *
 * @param type - The message type (required)
 * @param options - Optional confidence and tags
 * @returns Frozen ClassificationOutput object
 */
export function createClassificationOutput(
    type: MessageType,
    options?: { confidence?: number; tags?: string[] }
): ClassificationOutput {
    const output: ClassificationOutput = {
        type,
        ...(options?.confidence !== undefined && { confidence: options.confidence }),
        ...(options?.tags && { tags: Object.freeze([...options.tags]) }),
    };

    return Object.freeze(output);
}

/**
 * Get the effective confidence of a classification output.
 * Returns 1.0 if confidence is not specified.
 *
 * @param output - The classification output
 * @returns Confidence value (0.0 - 1.0)
 */
export function getEffectiveConfidence(output: ClassificationOutput): number {
    return output.confidence ?? 1.0;
}
