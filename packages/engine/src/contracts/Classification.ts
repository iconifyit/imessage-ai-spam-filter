/**
 * Classification Contract
 *
 * An immutable data object representing a classification decision.
 * This is pure data - no control flow, no behavior.
 */

/**
 * Immutable classification entity.
 *
 * Represents what a classifier decided about an entity.
 */
export interface Classification {
    /** Classification type (domain-defined, e.g., "spam", "personal", "marketing") */
    readonly type: string;

    /** Confidence score between 0.0 and 1.0 */
    readonly confidence: number;

    /** Human-readable explanation of why this classification was chosen */
    readonly reason: string;

    /** Identifier of the classifier that produced this */
    readonly classifierId: string;

    /** ISO timestamp when classification was made */
    readonly timestamp: string;
}

/**
 * Factory function to create a Classification.
 * Ensures timestamp is set and object is frozen (immutable).
 *
 * @param type - Classification type
 * @param confidence - Confidence score (0.0 - 1.0)
 * @param reason - Explanation for the classification
 * @param classifierId - ID of the classifier that produced this
 * @returns Frozen Classification object
 */
export function createClassification(
    type: string,
    confidence: number,
    reason: string,
    classifierId: string
): Classification {
    const classification: Classification = {
        type,
        confidence,
        reason,
        classifierId,
        timestamp: new Date().toISOString(),
    };

    return Object.freeze(classification);
}
