/**
 * Entity Contract
 *
 * The base shape of anything that flows through the TagRouter pipeline.
 * Domain implementations extend this with domain-specific metadata.
 *
 * Entities are immutable within the pipeline. Classifiers and actions
 * receive entities but cannot mutate them.
 */

/**
 * Base entity that all domain entities must satisfy.
 *
 * @typeParam TMetadata - Domain-specific metadata type
 *
 * @example
 * ```typescript
 * interface EmailMetadata {
 *     from: string;
 *     subject: string;
 *     receivedAt: Date;
 * }
 *
 * interface EmailEntity extends Entity<EmailMetadata> {}
 * ```
 */
export interface Entity<TMetadata extends object = Record<string, unknown>> {
    /** Unique identifier for this entity */
    readonly id: string;

    /** Primary content to be evaluated (message text, email body, etc.) */
    readonly content: string;

    /** Domain-specific metadata */
    readonly metadata: TMetadata;

    /** Trace ID assigned by engine for observability */
    readonly traceId?: string;
}

/**
 * Factory function type for creating entities.
 * Domain implementations provide their own factory.
 */
export type EntityFactory<T extends Entity<object> = Entity> = (
    data: Omit<T, "traceId">
) => T;
