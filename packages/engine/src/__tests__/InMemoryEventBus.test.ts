/**
 * @fileoverview Unit tests for InMemoryEventBus
 *
 * Tests cover:
 * - Basic event emission and subscription
 * - Wildcard subscriptions
 * - One-time subscriptions (once)
 * - Unsubscribe functionality
 * - Clear functionality
 * - Error handling in handlers
 *
 * @module @tagrouter/engine/__tests__/InMemoryEventBus
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryEventBus } from "../impl/InMemoryEventBus.js";
import type { EventPayload } from "../contracts/EventBus.js";

describe("InMemoryEventBus", () => {
    let eventBus: InMemoryEventBus;

    beforeEach(() => {
        eventBus = new InMemoryEventBus();
    });

    describe("subscribe and emit", () => {
        // Scenario: Basic subscription receives emitted events
        it("should call handler when matching event is emitted", () => {
            const handler = vi.fn();
            const event: EventPayload = {
                type     : "test:event",
                timestamp: "2025-01-15T10:00:00.000Z",
                data     : { message: "hello" },
            };

            eventBus.subscribe("test:event", handler);
            eventBus.emit(event);

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith(event);
        });

        // Scenario: Handler not called for non-matching event types
        it("should not call handler for non-matching event type", () => {
            const handler = vi.fn();
            const event: EventPayload = {
                type     : "other:event",
                timestamp: "2025-01-15T10:00:00.000Z",
            };

            eventBus.subscribe("test:event", handler);
            eventBus.emit(event);

            expect(handler).not.toHaveBeenCalled();
        });

        // Scenario: Multiple handlers for same event type
        it("should call all handlers subscribed to the same event type", () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();
            const event: EventPayload = {
                type     : "test:event",
                timestamp: "2025-01-15T10:00:00.000Z",
            };

            eventBus.subscribe("test:event", handler1);
            eventBus.subscribe("test:event", handler2);
            eventBus.emit(event);

            expect(handler1).toHaveBeenCalledTimes(1);
            expect(handler2).toHaveBeenCalledTimes(1);
        });

        // Scenario: Multiple events emitted
        it("should call handler for each emitted event", () => {
            const handler = vi.fn();
            const event1: EventPayload = {
                type     : "test:event",
                timestamp: "2025-01-15T10:00:00.000Z",
                data     : { count: 1 },
            };
            const event2: EventPayload = {
                type     : "test:event",
                timestamp: "2025-01-15T10:00:01.000Z",
                data     : { count: 2 },
            };

            eventBus.subscribe("test:event", handler);
            eventBus.emit(event1);
            eventBus.emit(event2);

            expect(handler).toHaveBeenCalledTimes(2);
            expect(handler).toHaveBeenNthCalledWith(1, event1);
            expect(handler).toHaveBeenNthCalledWith(2, event2);
        });
    });

    describe("wildcard subscription", () => {
        // Scenario: Wildcard handler receives all events
        it("should call wildcard handler for any event type", () => {
            const wildcardHandler = vi.fn();
            const event1: EventPayload = {
                type     : "entity:received",
                timestamp: "2025-01-15T10:00:00.000Z",
            };
            const event2: EventPayload = {
                type     : "engine:started",
                timestamp: "2025-01-15T10:00:01.000Z",
            };

            eventBus.subscribe("*", wildcardHandler);
            eventBus.emit(event1);
            eventBus.emit(event2);

            expect(wildcardHandler).toHaveBeenCalledTimes(2);
            expect(wildcardHandler).toHaveBeenNthCalledWith(1, event1);
            expect(wildcardHandler).toHaveBeenNthCalledWith(2, event2);
        });

        // Scenario: Both specific and wildcard handlers called
        it("should call both specific and wildcard handlers", () => {
            const specificHandler = vi.fn();
            const wildcardHandler = vi.fn();
            const event: EventPayload = {
                type     : "test:event",
                timestamp: "2025-01-15T10:00:00.000Z",
            };

            eventBus.subscribe("test:event", specificHandler);
            eventBus.subscribe("*", wildcardHandler);
            eventBus.emit(event);

            expect(specificHandler).toHaveBeenCalledTimes(1);
            expect(wildcardHandler).toHaveBeenCalledTimes(1);
        });
    });

    describe("once", () => {
        // Scenario: once() handler only called for first event
        it("should call handler only once then auto-unsubscribe", () => {
            const handler = vi.fn();
            const event: EventPayload = {
                type     : "test:event",
                timestamp: "2025-01-15T10:00:00.000Z",
            };

            eventBus.once("test:event", handler);
            eventBus.emit(event);
            eventBus.emit(event);
            eventBus.emit(event);

            expect(handler).toHaveBeenCalledTimes(1);
        });

        // Scenario: once() can be manually unsubscribed before event
        it("should allow manual unsubscribe before event is emitted", () => {
            const handler = vi.fn();
            const event: EventPayload = {
                type     : "test:event",
                timestamp: "2025-01-15T10:00:00.000Z",
            };

            const subscription = eventBus.once("test:event", handler);
            subscription.unsubscribe();
            eventBus.emit(event);

            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe("unsubscribe", () => {
        // Scenario: Unsubscribed handler not called
        it("should not call handler after unsubscribe", () => {
            const handler = vi.fn();
            const event: EventPayload = {
                type     : "test:event",
                timestamp: "2025-01-15T10:00:00.000Z",
            };

            const subscription = eventBus.subscribe("test:event", handler);
            eventBus.emit(event);
            subscription.unsubscribe();
            eventBus.emit(event);

            expect(handler).toHaveBeenCalledTimes(1);
        });

        // Scenario: Other handlers still called after one unsubscribes
        it("should still call other handlers after one unsubscribes", () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();
            const event: EventPayload = {
                type     : "test:event",
                timestamp: "2025-01-15T10:00:00.000Z",
            };

            const sub1 = eventBus.subscribe("test:event", handler1);
            eventBus.subscribe("test:event", handler2);

            sub1.unsubscribe();
            eventBus.emit(event);

            expect(handler1).not.toHaveBeenCalled();
            expect(handler2).toHaveBeenCalledTimes(1);
        });

        // Scenario: Double unsubscribe is safe (no error)
        it("should handle double unsubscribe gracefully", () => {
            const handler = vi.fn();

            const subscription = eventBus.subscribe("test:event", handler);
            subscription.unsubscribe();

            expect(() => subscription.unsubscribe()).not.toThrow();
        });
    });

    describe("clear", () => {
        // Scenario: Clear specific event type
        it("should remove all handlers for specific event type", () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();
            const otherHandler = vi.fn();
            const event: EventPayload = {
                type     : "test:event",
                timestamp: "2025-01-15T10:00:00.000Z",
            };
            const otherEvent: EventPayload = {
                type     : "other:event",
                timestamp: "2025-01-15T10:00:00.000Z",
            };

            eventBus.subscribe("test:event", handler1);
            eventBus.subscribe("test:event", handler2);
            eventBus.subscribe("other:event", otherHandler);

            eventBus.clear("test:event");
            eventBus.emit(event);
            eventBus.emit(otherEvent);

            expect(handler1).not.toHaveBeenCalled();
            expect(handler2).not.toHaveBeenCalled();
            expect(otherHandler).toHaveBeenCalledTimes(1);
        });

        // Scenario: Clear all with "*"
        it("should remove all handlers when clearing with '*'", () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();

            eventBus.subscribe("test:event", handler1);
            eventBus.subscribe("other:event", handler2);

            eventBus.clear("*");
            eventBus.emit({ type: "test:event", timestamp: "2025-01-15T10:00:00.000Z" });
            eventBus.emit({ type: "other:event", timestamp: "2025-01-15T10:00:00.000Z" });

            expect(handler1).not.toHaveBeenCalled();
            expect(handler2).not.toHaveBeenCalled();
        });

        // Scenario: Clear all with undefined
        it("should remove all handlers when clearing with undefined", () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();

            eventBus.subscribe("test:event", handler1);
            eventBus.subscribe("other:event", handler2);

            eventBus.clear();
            eventBus.emit({ type: "test:event", timestamp: "2025-01-15T10:00:00.000Z" });
            eventBus.emit({ type: "other:event", timestamp: "2025-01-15T10:00:00.000Z" });

            expect(handler1).not.toHaveBeenCalled();
            expect(handler2).not.toHaveBeenCalled();
        });
    });

    describe("handlerCount", () => {
        // Scenario: Count handlers for specific event type
        it("should return correct handler count", () => {
            eventBus.subscribe("test:event", vi.fn());
            eventBus.subscribe("test:event", vi.fn());
            eventBus.subscribe("other:event", vi.fn());

            expect(eventBus.handlerCount("test:event")).toBe(2);
            expect(eventBus.handlerCount("other:event")).toBe(1);
            expect(eventBus.handlerCount("unknown:event")).toBe(0);
        });
    });

    describe("error handling", () => {
        // Scenario: Handler error doesn't break other handlers
        it("should continue calling other handlers if one throws", () => {
            const errorHandler = vi.fn(() => {
                throw new Error("Handler error");
            });
            const successHandler = vi.fn();
            const event: EventPayload = {
                type     : "test:event",
                timestamp: "2025-01-15T10:00:00.000Z",
            };

            // Suppress console.error for this test
            const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

            eventBus.subscribe("test:event", errorHandler);
            eventBus.subscribe("test:event", successHandler);
            eventBus.emit(event);

            expect(errorHandler).toHaveBeenCalledTimes(1);
            expect(successHandler).toHaveBeenCalledTimes(1);
            expect(consoleSpy).toHaveBeenCalled();

            consoleSpy.mockRestore();
        });

        // Scenario: Wildcard handler error doesn't break emit
        it("should continue if wildcard handler throws", () => {
            const errorHandler = vi.fn(() => {
                throw new Error("Wildcard handler error");
            });
            const specificHandler = vi.fn();
            const event: EventPayload = {
                type     : "test:event",
                timestamp: "2025-01-15T10:00:00.000Z",
            };

            const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

            eventBus.subscribe("test:event", specificHandler);
            eventBus.subscribe("*", errorHandler);
            eventBus.emit(event);

            expect(specificHandler).toHaveBeenCalledTimes(1);
            expect(errorHandler).toHaveBeenCalledTimes(1);

            consoleSpy.mockRestore();
        });
    });

    describe("event payload", () => {
        // Scenario: Event with traceId
        it("should pass traceId to handler", () => {
            const handler = vi.fn();
            const event: EventPayload = {
                type     : "entity:processed",
                timestamp: "2025-01-15T10:00:00.000Z",
                traceId  : "tr_abc123_xyz",
                data     : { entityId: "msg-1" },
            };

            eventBus.subscribe("entity:processed", handler);
            eventBus.emit(event);

            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({
                    traceId: "tr_abc123_xyz",
                })
            );
        });
    });
});
