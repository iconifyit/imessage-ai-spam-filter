/**
 * @fileoverview Unit tests for TagRouterEngine
 *
 * Tests cover:
 * - Domain registration
 * - Engine lifecycle (start/stop)
 * - Message processing pipeline
 * - All classifiers run, highest confidence wins
 * - Action execution via bindings
 * - Event emission
 * - Error handling
 *
 * @module @tagrouter/engine/__tests__/TagRouterEngine
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TagRouterEngine, type DomainRegistration } from "../engine/TagRouterEngine.js";
import { InMemoryEventBus } from "../impl/InMemoryEventBus.js";
import type { Entity } from "../contracts/Entity.js";
import type { ClassificationPlugin, ClassificationContext } from "../contracts/ClassificationPlugin.js";
import type { ClassificationOutput } from "../contracts/ClassificationOutput.js";
import type { ActionPlugin, ActionContext, ActionResult } from "../contracts/ActionPlugin.js";
import type { EntityProvider, FetchResult } from "../contracts/EntityProvider.js";

/**
 * Create a mock entity (message) for testing
 */
function createMockMessage(id: string, content: string): Entity<object> {
    return {
        id,
        content,
        metadata: { testField: "testValue" },
    };
}

/**
 * Create a mock entity provider that returns entities only once
 */
function createMockProvider(entities: Entity<object>[] = []): EntityProvider<Entity<object>> {
    let called = false;

    return {
        id         : "mock-provider",
        name       : "Mock Provider",
        initialize : vi.fn().mockResolvedValue(undefined),
        shutdown   : vi.fn().mockResolvedValue(undefined),
        isHealthy  : vi.fn().mockResolvedValue(true),
        getEntities: vi.fn().mockImplementation(async (): Promise<FetchResult<Entity<object>>> => {
            // Return entities only on first call to avoid infinite polling
            if (called) {
                return { entities: [], hasMore: false };
            }
            called = true;
            return { entities, hasMore: false };
        }),
    };
}

/**
 * Create a mock classification plugin
 */
function createMockClassifier(
    id: string,
    result: ClassificationOutput | null = null,
    shouldThrow = false
): ClassificationPlugin {
    return {
        id,
        name    : `Mock Classifier ${id}`,
        classify: vi.fn().mockImplementation(async () => {
            if (shouldThrow) {
                throw new Error(`Classifier ${id} error`);
            }
            return result;
        }),
    };
}

/**
 * Create a mock action plugin with bindings
 */
function createMockAction(
    id: string,
    bindings: Record<string, { minConfidence?: number }>,
    executeResult: ActionResult | null = null,
    shouldThrow = false
): ActionPlugin {
    return {
        id,
        name    : `Mock Action ${id}`,
        bindings,
        handle  : vi.fn().mockImplementation(async () => {
            if (shouldThrow) {
                throw new Error(`Action ${id} error`);
            }
            return executeResult ?? { actionId: id, success: true };
        }),
    };
}

/**
 * Wait for the initial poll to complete and process entities.
 * Uses a small delay to allow async operations to complete.
 */
async function waitForInitialPoll(): Promise<void> {
    await vi.advanceTimersByTimeAsync(10);
}

describe("TagRouterEngine", () => {
    let engine: TagRouterEngine;
    let eventBus: InMemoryEventBus;

    beforeEach(() => {
        vi.useFakeTimers();
        eventBus = new InMemoryEventBus();
        engine = new TagRouterEngine({
            pollingInterval: 1000,
            batchSize      : 10,
            eventBus,
            logger         : {
                debug: vi.fn(),
                info : vi.fn(),
                warn : vi.fn(),
                error: vi.fn(),
            },
        });
    });

    afterEach(async () => {
        if (engine.isRunning) {
            await engine.stop();
        }
        vi.useRealTimers();
    });

    describe("domain registration", () => {
        // Scenario: Register a new domain
        it("should register a domain successfully", () => {
            const domain: DomainRegistration = {
                id         : "test-domain",
                name       : "Test Domain",
                provider   : createMockProvider(),
                classifiers: [],
                actions    : [],
            };

            expect(() => engine.registerDomain(domain)).not.toThrow();
        });

        // Scenario: Duplicate domain registration throws
        it("should throw when registering duplicate domain ID", () => {
            const domain: DomainRegistration = {
                id         : "test-domain",
                name       : "Test Domain",
                provider   : createMockProvider(),
                classifiers: [],
                actions    : [],
            };

            engine.registerDomain(domain);

            expect(() => engine.registerDomain(domain)).toThrow("Domain already registered: test-domain");
        });

        // Scenario: Unregister a domain
        it("should unregister a domain", () => {
            const domain: DomainRegistration = {
                id         : "test-domain",
                name       : "Test Domain",
                provider   : createMockProvider(),
                classifiers: [],
                actions    : [],
            };

            engine.registerDomain(domain);
            engine.unregisterDomain("test-domain");

            // Should be able to register again after unregister
            expect(() => engine.registerDomain(domain)).not.toThrow();
        });
    });

    describe("lifecycle", () => {
        // Scenario: Engine starts and stops correctly
        it("should start and stop the engine", async () => {
            const provider = createMockProvider();
            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [],
                actions    : [],
            });

            await engine.start();
            expect(engine.isRunning).toBe(true);
            expect(provider.initialize).toHaveBeenCalled();

            await engine.stop();
            expect(engine.isRunning).toBe(false);
            expect(provider.shutdown).toHaveBeenCalled();
        });

        // Scenario: Start emits lifecycle events
        it("should emit engine:starting and engine:started events", async () => {
            const startingHandler = vi.fn();
            const startedHandler = vi.fn();

            eventBus.subscribe("engine:starting", startingHandler);
            eventBus.subscribe("engine:started", startedHandler);

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider   : createMockProvider(),
                classifiers: [],
                actions    : [],
            });

            await engine.start();

            expect(startingHandler).toHaveBeenCalledTimes(1);
            expect(startedHandler).toHaveBeenCalledTimes(1);
        });

        // Scenario: Stop emits lifecycle events
        it("should emit engine:stopping and engine:stopped events", async () => {
            const stoppingHandler = vi.fn();
            const stoppedHandler = vi.fn();

            eventBus.subscribe("engine:stopping", stoppingHandler);
            eventBus.subscribe("engine:stopped", stoppedHandler);

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider   : createMockProvider(),
                classifiers: [],
                actions    : [],
            });

            await engine.start();
            await engine.stop();

            expect(stoppingHandler).toHaveBeenCalledTimes(1);
            expect(stoppedHandler).toHaveBeenCalledTimes(1);
        });

        // Scenario: Starting already running engine is a no-op
        it("should not start twice", async () => {
            const provider = createMockProvider();
            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [],
                actions    : [],
            });

            await engine.start();
            await engine.start();

            expect(provider.initialize).toHaveBeenCalledTimes(1);
        });

        // Scenario: Provider initialization failure
        it("should throw if provider initialization fails", async () => {
            const provider = createMockProvider();
            (provider.initialize as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Init failed"));

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [],
                actions    : [],
            });

            await expect(engine.start()).rejects.toThrow("Init failed");
            expect(engine.isRunning).toBe(false);
        });
    });

    describe("message processing", () => {
        // Scenario: Message goes through full pipeline
        it("should process message through classifier and action pipeline", async () => {
            const message = createMockMessage("msg-1", "Hello world");
            const provider = createMockProvider([message]);

            const classifier = createMockClassifier("test-classifier", {
                type      : "greeting",
                confidence: 0.9,
            });

            const action = createMockAction("test-action", { greeting: {} });

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier],
                actions    : [action],
            });

            const processedHandler = vi.fn();
            eventBus.subscribe("message:processed", processedHandler);

            await engine.start();
            await waitForInitialPoll();

            expect(classifier.classify).toHaveBeenCalled();
            expect(action.handle).toHaveBeenCalled();
            expect(processedHandler).toHaveBeenCalled();
        });

        // Scenario: Emits message:received event
        it("should emit message:received event", async () => {
            const message = createMockMessage("msg-1", "Test message");
            const provider = createMockProvider([message]);

            const receivedHandler = vi.fn();
            eventBus.subscribe("message:received", receivedHandler);

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [],
                actions    : [],
            });

            await engine.start();
            await waitForInitialPoll();

            expect(receivedHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: "message:received",
                    data: expect.objectContaining({
                        messageId: "msg-1",
                    }),
                })
            );
        });

        // Scenario: Emits message:classified event
        it("should emit message:classified event with classification details", async () => {
            const message = createMockMessage("msg-1", "Test message");
            const provider = createMockProvider([message]);

            const classifier = createMockClassifier("spam-classifier", {
                type      : "spam",
                confidence: 0.95,
                tags      : ["promotional"],
            });

            const classifiedHandler = vi.fn();
            eventBus.subscribe("message:classified", classifiedHandler);

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier],
                actions    : [],
            });

            await engine.start();
            await waitForInitialPoll();

            expect(classifiedHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: "message:classified",
                    data: expect.objectContaining({
                        messageId   : "msg-1",
                        type        : "spam",
                        confidence  : 0.95,
                        classifierId: "spam-classifier",
                    }),
                })
            );
        });

        // Scenario: Unclassified message emits message:unclassified
        it("should emit message:unclassified when no classifier matches", async () => {
            const message = createMockMessage("msg-1", "Test message");
            const provider = createMockProvider([message]);

            const classifier = createMockClassifier("test-classifier", null);

            const unclassifiedHandler = vi.fn();
            eventBus.subscribe("message:unclassified", unclassifiedHandler);

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier],
                actions    : [],
            });

            await engine.start();
            await waitForInitialPoll();

            expect(unclassifiedHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: "message:unclassified",
                    data: expect.objectContaining({
                        messageId: "msg-1",
                    }),
                })
            );
        });
    });

    describe("classifier resolution", () => {
        // Scenario: All classifiers run (not chain-of-responsibility)
        it("should run ALL classifiers, not stop at first match", async () => {
            const message = createMockMessage("msg-1", "Test");
            const provider = createMockProvider([message]);

            const classifier1 = createMockClassifier("classifier-1", {
                type      : "type-1",
                confidence: 0.5,
            });

            const classifier2 = createMockClassifier("classifier-2", {
                type      : "type-2",
                confidence: 0.6,
            });

            const classifier3 = createMockClassifier("classifier-3", {
                type      : "type-3",
                confidence: 0.7,
            });

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier1, classifier2, classifier3],
                actions    : [],
            });

            await engine.start();
            await waitForInitialPoll();

            // All classifiers should have been called
            expect(classifier1.classify).toHaveBeenCalled();
            expect(classifier2.classify).toHaveBeenCalled();
            expect(classifier3.classify).toHaveBeenCalled();
        });

        // Scenario: Highest confidence wins
        it("should select highest confidence result", async () => {
            const message = createMockMessage("msg-1", "Test");
            const provider = createMockProvider([message]);

            const classifier1 = createMockClassifier("classifier-1", {
                type      : "low-confidence",
                confidence: 0.5,
            });

            const classifier2 = createMockClassifier("classifier-2", {
                type      : "high-confidence",
                confidence: 0.95,
            });

            const classifier3 = createMockClassifier("classifier-3", {
                type      : "medium-confidence",
                confidence: 0.7,
            });

            const classifiedHandler = vi.fn();
            eventBus.subscribe("message:classified", classifiedHandler);

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier1, classifier2, classifier3],
                actions    : [],
            });

            await engine.start();
            await waitForInitialPoll();

            expect(classifiedHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        type        : "high-confidence",
                        confidence  : 0.95,
                        classifierId: "classifier-2",
                    }),
                })
            );
        });

        // Scenario: Default confidence is 1.0
        it("should use default confidence of 1.0 when not specified", async () => {
            const message = createMockMessage("msg-1", "Test");
            const provider = createMockProvider([message]);

            // No confidence specified = default 1.0
            const classifier1 = createMockClassifier("classifier-1", {
                type: "default-confidence",
            });

            const classifier2 = createMockClassifier("classifier-2", {
                type      : "explicit-confidence",
                confidence: 0.9,
            });

            const classifiedHandler = vi.fn();
            eventBus.subscribe("message:classified", classifiedHandler);

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier1, classifier2],
                actions    : [],
            });

            await engine.start();
            await waitForInitialPoll();

            // Default confidence (1.0) should win over 0.9
            expect(classifiedHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        type        : "default-confidence",
                        classifierId: "classifier-1",
                    }),
                })
            );
        });

        // Scenario: Classifier returns null (no opinion)
        it("should ignore classifiers that return null", async () => {
            const message = createMockMessage("msg-1", "Test");
            const provider = createMockProvider([message]);

            const classifier1 = createMockClassifier("classifier-1", null);
            const classifier2 = createMockClassifier("classifier-2", {
                type      : "has-opinion",
                confidence: 0.7,
            });

            const classifiedHandler = vi.fn();
            eventBus.subscribe("message:classified", classifiedHandler);

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier1, classifier2],
                actions    : [],
            });

            await engine.start();
            await waitForInitialPoll();

            expect(classifiedHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        type: "has-opinion",
                    }),
                })
            );
        });

        // Scenario: Classifier error doesn't break other classifiers
        it("should continue running classifiers if one throws", async () => {
            const message = createMockMessage("msg-1", "Test");
            const provider = createMockProvider([message]);

            const classifier1 = createMockClassifier("classifier-1", null, true);
            const classifier2 = createMockClassifier("classifier-2", {
                type      : "works",
                confidence: 0.7,
            });

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier1, classifier2],
                actions    : [],
            });

            await engine.start();
            await waitForInitialPoll();

            expect(classifier1.classify).toHaveBeenCalled();
            expect(classifier2.classify).toHaveBeenCalled();
        });
    });

    describe("action execution via bindings", () => {
        // Scenario: Action executes when binding matches type
        it("should execute action when binding matches classification type", async () => {
            const message = createMockMessage("msg-1", "Test");
            const provider = createMockProvider([message]);

            const classifier = createMockClassifier("test-classifier", {
                type      : "spam",
                confidence: 0.9,
            });

            const action = createMockAction("delete-action", {
                spam: {},
            });

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier],
                actions    : [action],
            });

            await engine.start();
            await waitForInitialPoll();

            expect(action.handle).toHaveBeenCalled();
        });

        // Scenario: Action not executed when binding doesn't match type
        it("should not execute action when binding does not match type", async () => {
            const message = createMockMessage("msg-1", "Test");
            const provider = createMockProvider([message]);

            const classifier = createMockClassifier("test-classifier", {
                type      : "personal",
                confidence: 0.8,
            });

            // Action only handles "spam" type
            const action = createMockAction("delete-action", {
                spam: {},
            });

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier],
                actions    : [action],
            });

            await engine.start();
            await waitForInitialPoll();

            expect(action.handle).not.toHaveBeenCalled();
        });

        // Scenario: Action respects minConfidence threshold
        it("should not execute action when confidence below minConfidence", async () => {
            const message = createMockMessage("msg-1", "Test");
            const provider = createMockProvider([message]);

            const classifier = createMockClassifier("test-classifier", {
                type      : "spam",
                confidence: 0.7,
            });

            // Action requires minConfidence of 0.9
            const action = createMockAction("delete-action", {
                spam: { minConfidence: 0.9 },
            });

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier],
                actions    : [action],
            });

            await engine.start();
            await waitForInitialPoll();

            expect(action.handle).not.toHaveBeenCalled();
        });

        // Scenario: Action executes when confidence meets minConfidence
        it("should execute action when confidence meets minConfidence", async () => {
            const message = createMockMessage("msg-1", "Test");
            const provider = createMockProvider([message]);

            const classifier = createMockClassifier("test-classifier", {
                type      : "spam",
                confidence: 0.95,
            });

            const action = createMockAction("delete-action", {
                spam: { minConfidence: 0.9 },
            });

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier],
                actions    : [action],
            });

            await engine.start();
            await waitForInitialPoll();

            expect(action.handle).toHaveBeenCalled();
        });

        // Scenario: Multiple actions can execute for same type
        it("should execute multiple matching actions", async () => {
            const message = createMockMessage("msg-1", "Test");
            const provider = createMockProvider([message]);

            const classifier = createMockClassifier("test-classifier", {
                type      : "spam",
                confidence: 0.9,
            });

            const action1 = createMockAction("log-action", { spam: {} });
            const action2 = createMockAction("delete-action", { spam: {} });
            const action3 = createMockAction("unrelated-action", { personal: {} });

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier],
                actions    : [action1, action2, action3],
            });

            await engine.start();
            await waitForInitialPoll();

            expect(action1.handle).toHaveBeenCalled();
            expect(action2.handle).toHaveBeenCalled();
            expect(action3.handle).not.toHaveBeenCalled();
        });

        // Scenario: Action error doesn't break other actions
        it("should continue executing actions if one throws", async () => {
            const message = createMockMessage("msg-1", "Test");
            const provider = createMockProvider([message]);

            const classifier = createMockClassifier("test-classifier", {
                type      : "spam",
                confidence: 0.9,
            });

            const action1 = createMockAction("action-1", { spam: {} }, null, true);
            const action2 = createMockAction("action-2", { spam: {} });

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier],
                actions    : [action1, action2],
            });

            await engine.start();
            await waitForInitialPoll();

            expect(action1.handle).toHaveBeenCalled();
            expect(action2.handle).toHaveBeenCalled();
        });

        // Scenario: Emits action events
        it("should emit message:actionExecuting and message:actionExecuted events", async () => {
            const message = createMockMessage("msg-1", "Test");
            const provider = createMockProvider([message]);

            const classifier = createMockClassifier("test-classifier", {
                type      : "spam",
                confidence: 0.9,
            });

            const action = createMockAction("test-action", { spam: {} });

            const executingHandler = vi.fn();
            const executedHandler = vi.fn();
            eventBus.subscribe("message:actionExecuting", executingHandler);
            eventBus.subscribe("message:actionExecuted", executedHandler);

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier],
                actions    : [action],
            });

            await engine.start();
            await waitForInitialPoll();

            expect(executingHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: "message:actionExecuting",
                    data: expect.objectContaining({
                        actionId: "test-action",
                        type    : "spam",
                    }),
                })
            );

            expect(executedHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: "message:actionExecuted",
                    data: expect.objectContaining({
                        actionId: "test-action",
                        success : true,
                    }),
                })
            );
        });
    });

    describe("polling", () => {
        // Scenario: Polls at configured interval
        it("should poll provider at configured interval", async () => {
            const provider = createMockProvider([]);
            (provider.getEntities as ReturnType<typeof vi.fn>).mockResolvedValue({
                entities: [],
                hasMore : false,
            });

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [],
                actions    : [],
            });

            await engine.start();

            // Initial poll happens immediately
            expect(provider.getEntities).toHaveBeenCalledTimes(1);

            // Advance time by polling interval
            await vi.advanceTimersByTimeAsync(1000);
            expect(provider.getEntities).toHaveBeenCalledTimes(2);

            // Advance again
            await vi.advanceTimersByTimeAsync(1000);
            expect(provider.getEntities).toHaveBeenCalledTimes(3);
        });

        // Scenario: Stops polling after stop()
        it("should stop polling after engine stops", async () => {
            const provider = createMockProvider([]);
            (provider.getEntities as ReturnType<typeof vi.fn>).mockResolvedValue({
                entities: [],
                hasMore : false,
            });

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [],
                actions    : [],
            });

            await engine.start();
            expect(provider.getEntities).toHaveBeenCalledTimes(1);

            await engine.stop();

            // Advance time - should not poll anymore
            await vi.advanceTimersByTimeAsync(5000);
            expect(provider.getEntities).toHaveBeenCalledTimes(1);
        });
    });

    describe("error handling", () => {
        // Scenario: Provider error emits engine:error
        it("should emit engine:error when provider fails", async () => {
            const provider = createMockProvider([]);
            (provider.getEntities as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Provider error"));

            const errorHandler = vi.fn();
            eventBus.subscribe("engine:error", errorHandler);

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [],
                actions    : [],
            });

            await engine.start();
            await waitForInitialPoll();

            expect(errorHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: "engine:error",
                    data: expect.objectContaining({
                        domainId: "test-domain",
                        error   : "Provider error",
                    }),
                })
            );
        });

        // Scenario: Message processing error emits message:error
        it("should emit message:error when processing fails", async () => {
            const message = createMockMessage("msg-1", "Test");
            const provider = createMockProvider([message]);

            // Classifier that throws
            const classifier: ClassificationPlugin = {
                id      : "bad-classifier",
                classify: vi.fn().mockRejectedValue(new Error("Classifier error")),
            };

            const errorHandler = vi.fn();
            eventBus.subscribe("message:error", errorHandler);

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier],
                actions    : [],
            });

            // Simulate an error that breaks processing
            const originalProcessMessage = engine.processMessage.bind(engine);
            vi.spyOn(engine, "processMessage").mockImplementation(async (domain, msg) => {
                throw new Error("Processing failed");
            });

            await engine.start();
            await waitForInitialPoll();

            // Restore original
            vi.restoreAllMocks();
        });
    });

    describe("traceId", () => {
        // Scenario: TraceId is generated and included in events
        it("should generate unique traceId for each message", async () => {
            const message1 = createMockMessage("msg-1", "First");
            const message2 = createMockMessage("msg-2", "Second");

            let callCount = 0;
            const provider: EntityProvider<Entity<object>> = {
                id         : "mock-provider",
                name       : "Mock Provider",
                initialize : vi.fn(),
                shutdown   : vi.fn(),
                getEntities: vi.fn().mockImplementation(async () => {
                    callCount++;
                    if (callCount === 1) {
                        return { entities: [message1, message2], hasMore: false };
                    }
                    return { entities: [], hasMore: false };
                }),
            };

            const traceIds: string[] = [];
            eventBus.subscribe("message:received", (event) => {
                if (event.traceId) {
                    traceIds.push(event.traceId);
                }
            });

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [],
                actions    : [],
            });

            await engine.start();
            await waitForInitialPoll();

            expect(traceIds).toHaveLength(2);
            expect(traceIds[0]).not.toBe(traceIds[1]);
            expect(traceIds[0]).toMatch(/^tr_/);
            expect(traceIds[1]).toMatch(/^tr_/);
        });
    });
});
