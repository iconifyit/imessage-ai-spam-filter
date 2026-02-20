/**
 * @fileoverview In-Memory EventBus Implementation
 *
 * A simple, synchronous, in-memory event bus for local daemon use.
 *
 * @module @tagrouter/engine/impl/InMemoryEventBus
 */

import type {
    EventBus,
    EventPayload,
    EventHandler,
    EventType,
    Subscription,
} from "../contracts/EventBus.js";

/**
 * In-memory EventBus implementation.
 *
 * Features:
 * - Synchronous event dispatch
 * - Wildcard subscription ("*" for all events)
 * - One-time subscriptions via once()
 * - Thread-safe for single-threaded Node.js
 *
 * @example
 * ```typescript
 * const bus = new InMemoryEventBus();
 *
 * bus.subscribe("entity:classified", (event) => {
 *     console.log("Classified:", event.data);
 * });
 *
 * bus.emit(createEvent("entity:classified", { type: "spam" }));
 * ```
 */
export class InMemoryEventBus implements EventBus {
    private handlers: Map<string, Set<EventHandler>> = new Map();

    /**
     * Emit an event to all subscribers.
     *
     * Events are dispatched synchronously to all matching handlers.
     * Handlers for "*" receive all events.
     *
     * @param event - The event payload to emit
     */
    emit(event: EventPayload): void {
        // Call specific event handlers
        const specificHandlers = this.handlers.get(event.type);
        if (specificHandlers) {
            for (const handler of specificHandlers) {
                try {
                    handler(event);
                }
                catch (error) {
                    // Log but don't throw - one handler failure shouldn't break others
                    console.error(`EventBus handler error for ${event.type}:`, error);
                }
            }
        }

        // Call wildcard handlers
        const wildcardHandlers = this.handlers.get("*");
        if (wildcardHandlers) {
            for (const handler of wildcardHandlers) {
                try {
                    handler(event);
                }
                catch (error) {
                    console.error(`EventBus wildcard handler error:`, error);
                }
            }
        }
    }

    /**
     * Subscribe to events of a specific type.
     *
     * @param eventType - The event type to subscribe to (or "*" for all events)
     * @param handler - Handler function called when event is emitted
     * @returns Subscription handle for unsubscribing
     */
    subscribe(eventType: EventType | "*", handler: EventHandler): Subscription {
        if (!this.handlers.has(eventType)) {
            this.handlers.set(eventType, new Set());
        }

        this.handlers.get(eventType)!.add(handler);

        return {
            unsubscribe: () => {
                const handlers = this.handlers.get(eventType);
                if (handlers) {
                    handlers.delete(handler);
                    if (handlers.size === 0) {
                        this.handlers.delete(eventType);
                    }
                }
            },
        };
    }

    /**
     * Subscribe to events of a specific type, auto-unsubscribe after first event.
     *
     * @param eventType - The event type to subscribe to
     * @param handler - Handler function called when event is emitted
     * @returns Subscription handle for manual unsubscription if needed
     */
    once(eventType: EventType, handler: EventHandler): Subscription {
        const wrappedHandler: EventHandler = (event) => {
            subscription.unsubscribe();
            handler(event);
        };

        const subscription = this.subscribe(eventType, wrappedHandler);
        return subscription;
    }

    /**
     * Remove all subscriptions for a specific event type.
     *
     * @param eventType - The event type to clear (or "*" for all, undefined clears everything)
     */
    clear(eventType?: EventType | "*"): void {
        if (eventType === undefined || eventType === "*") {
            this.handlers.clear();
        }
        else {
            this.handlers.delete(eventType);
        }
    }

    /**
     * Get the number of handlers for a specific event type.
     * Useful for testing.
     *
     * @param eventType - The event type to check
     * @returns Number of handlers
     */
    handlerCount(eventType: EventType | "*"): number {
        return this.handlers.get(eventType)?.size ?? 0;
    }
}
