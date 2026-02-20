/**
 * @fileoverview EventBus Contract
 *
 * Defines the contract for internal event flow within the TagRouter engine.
 * Events enable observability, decoupling, and extensibility.
 *
 * Design decisions:
 * - Synchronous by default (simpler for local daemon)
 * - In-memory implementation (no external queue dependency)
 * - Ordering is preserved within a single event type
 *
 * @module @tagrouter/engine/contracts/EventBus
 */

/**
 * Event payload base interface.
 * All events must have a type and timestamp.
 */
export interface EventPayload {
    /** Event type identifier */
    readonly type: string;

    /** ISO timestamp when event was emitted */
    readonly timestamp: string;

    /** Trace ID for correlation */
    readonly traceId?: string;

    /** Additional event-specific data */
    readonly data?: Record<string, unknown>;
}

/**
 * Lifecycle event types emitted by the engine.
 */
export type LifecycleEventType =
    | "engine:starting"
    | "engine:started"
    | "engine:stopping"
    | "engine:stopped"
    | "engine:error";

/**
 * Processing event types emitted during entity processing.
 */
export type ProcessingEventType =
    | "entity:received"
    | "entity:classifying"
    | "entity:classified"
    | "entity:actionExecuting"
    | "entity:actionExecuted"
    | "entity:processed"
    | "entity:error";

/**
 * All known event types.
 */
export type EventType = LifecycleEventType | ProcessingEventType | string;

/**
 * Event handler function signature.
 */
export type EventHandler<T extends EventPayload = EventPayload> = (event: T) => void | Promise<void>;

/**
 * Subscription handle returned when subscribing to events.
 */
export interface Subscription {
    /** Unsubscribe from the event */
    unsubscribe(): void;
}

/**
 * EventBus interface.
 *
 * Provides a simple pub/sub mechanism for internal events.
 *
 * @example
 * ```typescript
 * const bus: EventBus = new InMemoryEventBus();
 *
 * // Subscribe to events
 * const sub = bus.subscribe("entity:classified", (event) => {
 *     console.log("Entity classified:", event.data);
 * });
 *
 * // Emit an event
 * bus.emit({
 *     type: "entity:classified",
 *     timestamp: new Date().toISOString(),
 *     traceId: "abc-123",
 *     data: { entityId: "1", classification: "spam" },
 * });
 *
 * // Unsubscribe when done
 * sub.unsubscribe();
 * ```
 */
export interface EventBus {
    /**
     * Emit an event to all subscribers.
     *
     * @param event - The event payload to emit
     */
    emit(event: EventPayload): void;

    /**
     * Subscribe to events of a specific type.
     *
     * @param eventType - The event type to subscribe to (or "*" for all events)
     * @param handler - Handler function called when event is emitted
     * @returns Subscription handle for unsubscribing
     */
    subscribe(eventType: EventType | "*", handler: EventHandler): Subscription;

    /**
     * Subscribe to events of a specific type, auto-unsubscribe after first event.
     *
     * @param eventType - The event type to subscribe to
     * @param handler - Handler function called when event is emitted
     * @returns Subscription handle for manual unsubscription if needed
     */
    once(eventType: EventType, handler: EventHandler): Subscription;

    /**
     * Remove all subscriptions for a specific event type.
     *
     * @param eventType - The event type to clear (or "*" for all)
     */
    clear(eventType?: EventType | "*"): void;
}

/**
 * Factory function to create an event payload.
 *
 * @param type - Event type
 * @param data - Optional event data
 * @param traceId - Optional trace ID
 * @returns Event payload with timestamp
 */
export function createEvent(
    type: EventType,
    data?: Record<string, unknown>,
    traceId?: string
): EventPayload {
    return {
        type,
        timestamp: new Date().toISOString(),
        traceId,
        data,
    };
}
