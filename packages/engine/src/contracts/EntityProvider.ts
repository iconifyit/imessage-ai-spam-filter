/**
 * EntityProvider Contract
 *
 * Entity providers are passive data sources. The engine pulls
 * entities from providers during each polling cycle.
 *
 * Design principles:
 * - Passive: Providers don't push; engine pulls
 * - Stateless fetch: Each call to getEntities() is independent
 * - May track cursor: Providers can track what's been seen
 */

import type { Entity } from "./Entity.js";

/**
 * Options for fetching entities.
 */
export interface FetchOptions {
    /** Maximum number of entities to fetch */
    readonly limit?: number;

    /** Fetch entities after this cursor/timestamp */
    readonly since?: string | Date;

    /** Additional provider-specific options */
    readonly [key: string]: unknown;
}

/**
 * Result of fetching entities.
 */
export interface FetchResult<T extends Entity<object> = Entity> {
    /** Entities fetched */
    readonly entities: readonly T[];

    /** Cursor for next fetch (provider-specific) */
    readonly cursor?: string;

    /** Whether there are more entities available */
    readonly hasMore: boolean;
}

/**
 * EntityProvider interface.
 *
 * Providers are passive data sources. The TagRouter engine
 * periodically calls getEntities() to pull new data.
 *
 * Providers are responsible for:
 * - Connecting to data sources (DB, API, file, etc.)
 * - Converting raw data to Entity shape
 * - Tracking what has been seen (cursor management)
 *
 * @example
 * ```typescript
 * class DatabaseProvider implements EntityProvider<MyEntity> {
 *     readonly id = "db-provider";
 *     readonly name = "Database Provider";
 *
 *     async initialize() {
 *         await this.db.connect();
 *     }
 *
 *     async getEntities(options?: FetchOptions) {
 *         const rows = await this.db.query("SELECT * FROM items WHERE id > ?", [options?.since]);
 *         return {
 *             entities: rows.map(toEntity),
 *             cursor: rows[rows.length - 1]?.id,
 *             hasMore: rows.length === options?.limit,
 *         };
 *     }
 *
 *     async shutdown() {
 *         await this.db.disconnect();
 *     }
 * }
 * ```
 */
export interface EntityProvider<T extends Entity<object> = Entity> {
    /** Unique identifier for this provider */
    readonly id: string;

    /** Human-readable name */
    readonly name: string;

    /** Optional description */
    readonly description?: string;

    /**
     * Initialize the provider.
     * Called once when the engine starts.
     */
    initialize?(): Promise<void>;

    /**
     * Fetch entities from the data source.
     * This is the primary method called by the engine during each polling cycle.
     *
     * @param options - Fetch options (limit, since, etc.)
     * @returns Fetch result with entities and cursor
     */
    getEntities(options?: FetchOptions): Promise<FetchResult<T>>;

    /**
     * Shutdown the provider.
     * Called once when the engine stops.
     */
    shutdown?(): Promise<void>;

    /**
     * Health check for the provider.
     *
     * @returns true if the provider is healthy
     */
    isHealthy?(): Promise<boolean>;
}
