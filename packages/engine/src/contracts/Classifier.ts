/**
 * Classifier Contract
 *
 * Classifiers evaluate entities and return classification results.
 * They are pure functions - no side effects, no mutation.
 *
 * Classifiers may signal that evaluation should halt (short-circuit)
 * by setting `halt: true` in the result. The engine respects this
 * and skips remaining classifiers in the chain.
 *
 * Design principles:
 * - Pure: No side effects, no entity mutation
 * - Deterministic: Same input produces same output
 * - Composable: Can be chained via Chain of Responsibility
 */

import type { Entity } from "./Entity.js";
import type { Classification } from "./Classification.js";

/**
 * Result returned by a classifier after evaluating an entity.
 *
 * Wraps the immutable Classification with control flow properties.
 */
export interface ClassifierResult {
    /** The classification decision (immutable) */
    readonly classification: Classification;

    /**
     * If true, halt the classifier chain.
     * No further classifiers will be evaluated.
     * Use for authoritative decisions.
     */
    readonly halt?: boolean;

    /** Additional metadata (domain-specific) */
    readonly annotations?: Record<string, unknown>;
}

/**
 * Context provided to classifiers during evaluation.
 */
export interface ClassifierContext {
    /** Read-only configuration */
    readonly config: Readonly<Record<string, unknown>>;

    /** Logger for the classifier */
    readonly logger: ClassifierLogger;

    /** Previous classifications in the chain (if any) */
    readonly previousClassifications: readonly Classification[];
}

/**
 * Logger interface for classifiers.
 */
export interface ClassifierLogger {
    debug(message: string, data?: Record<string, unknown>): void;
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Classifier interface.
 *
 * Classifiers are stateless evaluators. They receive an entity
 * and context, and return a classification result.
 *
 * A classifier may return `null` to indicate "no opinion" -
 * the entity doesn't match this classifier's criteria.
 *
 * @example
 * ```typescript
 * const spamClassifier: Classifier = {
 *     id: "spam-detector",
 *     name: "Spam Detector",
 *     async evaluate(entity, context) {
 *         const isSpam = checkForSpam(entity.content);
 *         if (isSpam) {
 *             return {
 *                 classification: createClassification("spam", 0.95, "Contains spam keywords", this.id),
 *                 halt: true,
 *             };
 *         }
 *         return null; // No opinion
 *     }
 * };
 * ```
 */
export interface Classifier {
    /** Unique identifier for this classifier */
    readonly id: string;

    /** Human-readable name */
    readonly name: string;

    /** Optional description */
    readonly description?: string;

    /**
     * Evaluate an entity and return a classification result.
     *
     * @param entity - The entity to evaluate (read-only)
     * @param context - Evaluation context (config, logger, previous classifications)
     * @returns Classification result, or null if no opinion
     */
    evaluate(
        entity: Entity<object>,
        context: ClassifierContext
    ): Promise<ClassifierResult | null> | ClassifierResult | null;
}

/**
 * Type guard to check if a classifier result signals halt.
 */
export function shouldHalt(result: ClassifierResult | null): boolean {
    return result?.halt === true;
}
