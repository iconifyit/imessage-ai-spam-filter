/**
 * @fileoverview Unit tests for TagRouterEngine
 *
 * Tests cover:
 * - Domain registration
 * - Engine lifecycle (start/stop)
 * - Entity processing pipeline
 * - Classifier chain execution
 * - Action execution
 * - Event emission
 * - Error handling
 *
 * @module @tagrouter/engine/__tests__/TagRouterEngine
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TagRouterEngine, type DomainRegistration } from "../engine/TagRouterEngine.js";
import { InMemoryEventBus } from "../impl/InMemoryEventBus.js";
import type { Entity } from "../contracts/Entity.js";
import type { Classifier, ClassifierResult, ClassifierContext } from "../contracts/Classifier.js";
import type { Action, ActionContext, ActionResult } from "../contracts/Action.js";
import type { EntityProvider, FetchResult, FetchOptions } from "../contracts/EntityProvider.js";
import { createClassification } from "../contracts/Classification.js";

/**
 * Create a mock entity for testing
 */
function createMockEntity(id: string, content: string): Entity<object> {
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
 * Create a mock classifier
 */
function createMockClassifier(
    id: string,
    result: ClassifierResult | null = null,
    shouldThrow = false
): Classifier {
    return {
        id,
        name    : `Mock Classifier ${id}`,
        evaluate: vi.fn().mockImplementation(async () => {
            if (shouldThrow) {
                throw new Error(`Classifier ${id} error`);
            }
            return result;
        }),
    };
}

/**
 * Create a mock action
 */
function createMockAction(
    id: string,
    shouldExecuteResult: boolean,
    executeResult: ActionResult | null = null,
    shouldThrow = false
): Action {
    return {
        id,
        name         : `Mock Action ${id}`,
        shouldExecute: vi.fn().mockReturnValue(shouldExecuteResult),
        execute      : vi.fn().mockImplementation(async () => {
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
    // Allow microtasks to complete (Promise resolutions)
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

    describe("entity processing", () => {
        // Scenario: Entity goes through full pipeline
        it("should process entity through classifier and action pipeline", async () => {
            const entity = createMockEntity("msg-1", "Hello world");
            const provider = createMockProvider([entity]);

            const classifierResult: ClassifierResult = {
                classification: createClassification("greeting", 0.9, "Friendly message", "test-classifier"),
            };
            const classifier = createMockClassifier("test-classifier", classifierResult);

            const action = createMockAction("test-action", true);

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier],
                actions    : [action],
            });

            const processedHandler = vi.fn();
            eventBus.subscribe("entity:processed", processedHandler);

            await engine.start();
            await waitForInitialPoll();

            expect(classifier.evaluate).toHaveBeenCalled();
            expect(action.shouldExecute).toHaveBeenCalled();
            expect(action.execute).toHaveBeenCalled();
            expect(processedHandler).toHaveBeenCalled();
        });

        // Scenario: Emits entity:received event
        it("should emit entity:received event", async () => {
            const entity = createMockEntity("msg-1", "Test message");
            const provider = createMockProvider([entity]);

            const receivedHandler = vi.fn();
            eventBus.subscribe("entity:received", receivedHandler);

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
                    type: "entity:received",
                    data: expect.objectContaining({
                        entityId: "msg-1",
                    }),
                })
            );
        });

        // Scenario: Emits entity:classified event
        it("should emit entity:classified event with classification details", async () => {
            const entity = createMockEntity("msg-1", "Test message");
            const provider = createMockProvider([entity]);

            const classifierResult: ClassifierResult = {
                classification: createClassification("spam", 0.95, "Spam detected", "spam-classifier"),
            };
            const classifier = createMockClassifier("spam-classifier", classifierResult);

            const classifiedHandler = vi.fn();
            eventBus.subscribe("entity:classified", classifiedHandler);

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
                    type: "entity:classified",
                    data: expect.objectContaining({
                        entityId       : "msg-1",
                        classifications: expect.arrayContaining([
                            expect.objectContaining({ type: "spam", confidence: 0.95 }),
                        ]),
                    }),
                })
            );
        });
    });

    describe("classifier chain", () => {
        // Scenario: Multiple classifiers run in order
        it("should run classifiers in order", async () => {
            const entity = createMockEntity("msg-1", "Test");
            const provider = createMockProvider([entity]);

            const callOrder: string[] = [];

            const classifier1: Classifier = {
                id      : "classifier-1",
                name    : "Classifier 1",
                evaluate: vi.fn().mockImplementation(async () => {
                    callOrder.push("classifier-1");
                    return {
                        classification: createClassification("type-1", 0.5, "First", "classifier-1"),
                    };
                }),
            };

            const classifier2: Classifier = {
                id      : "classifier-2",
                name    : "Classifier 2",
                evaluate: vi.fn().mockImplementation(async () => {
                    callOrder.push("classifier-2");
                    return {
                        classification: createClassification("type-2", 0.6, "Second", "classifier-2"),
                    };
                }),
            };

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier1, classifier2],
                actions    : [],
            });

            await engine.start();
            await waitForInitialPoll();

            expect(callOrder).toEqual(["classifier-1", "classifier-2"]);
        });

        // Scenario: Classifier returns halt to stop chain
        it("should halt classifier chain when halt is true", async () => {
            const entity = createMockEntity("msg-1", "Test");
            const provider = createMockProvider([entity]);

            const classifier1: Classifier = {
                id      : "classifier-1",
                name    : "Classifier 1",
                evaluate: vi.fn().mockResolvedValue({
                    classification: createClassification("spam", 0.99, "Definite spam", "classifier-1"),
                    halt          : true,
                }),
            };

            const classifier2 = createMockClassifier("classifier-2", {
                classification: createClassification("other", 0.5, "Other", "classifier-2"),
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

            expect(classifier1.evaluate).toHaveBeenCalled();
            expect(classifier2.evaluate).not.toHaveBeenCalled();
        });

        // Scenario: Classifier returns null (no opinion)
        it("should continue chain when classifier returns null", async () => {
            const entity = createMockEntity("msg-1", "Test");
            const provider = createMockProvider([entity]);

            const classifier1 = createMockClassifier("classifier-1", null);
            const classifier2 = createMockClassifier("classifier-2", {
                classification: createClassification("type-2", 0.7, "Has opinion", "classifier-2"),
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

            expect(classifier1.evaluate).toHaveBeenCalled();
            expect(classifier2.evaluate).toHaveBeenCalled();
        });

        // Scenario: Classifier error doesn't break chain
        it("should continue chain if classifier throws", async () => {
            const entity = createMockEntity("msg-1", "Test");
            const provider = createMockProvider([entity]);

            const classifier1 = createMockClassifier("classifier-1", null, true);
            const classifier2 = createMockClassifier("classifier-2", {
                classification: createClassification("type-2", 0.7, "Works", "classifier-2"),
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

            expect(classifier1.evaluate).toHaveBeenCalled();
            expect(classifier2.evaluate).toHaveBeenCalled();
        });
    });

    describe("action execution", () => {
        // Scenario: Action executes when shouldExecute returns true
        it("should execute action when shouldExecute returns true", async () => {
            const entity = createMockEntity("msg-1", "Test");
            const provider = createMockProvider([entity]);

            const classifier = createMockClassifier("test-classifier", {
                classification: createClassification("spam", 0.9, "Spam", "test-classifier"),
            });

            const action = createMockAction("delete-action", true);

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier],
                actions    : [action],
            });

            await engine.start();
            await waitForInitialPoll();

            expect(action.shouldExecute).toHaveBeenCalled();
            expect(action.execute).toHaveBeenCalled();
        });

        // Scenario: Action not executed when shouldExecute returns false
        it("should not execute action when shouldExecute returns false", async () => {
            const entity = createMockEntity("msg-1", "Test");
            const provider = createMockProvider([entity]);

            const classifier = createMockClassifier("test-classifier", {
                classification: createClassification("personal", 0.8, "Personal", "test-classifier"),
            });

            const action = createMockAction("delete-action", false);

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier],
                actions    : [action],
            });

            await engine.start();
            await waitForInitialPoll();

            expect(action.shouldExecute).toHaveBeenCalled();
            expect(action.execute).not.toHaveBeenCalled();
        });

        // Scenario: Multiple actions can execute
        it("should execute multiple matching actions", async () => {
            const entity = createMockEntity("msg-1", "Test");
            const provider = createMockProvider([entity]);

            const classifier = createMockClassifier("test-classifier", {
                classification: createClassification("spam", 0.9, "Spam", "test-classifier"),
            });

            const action1 = createMockAction("action-1", true);
            const action2 = createMockAction("action-2", true);
            const action3 = createMockAction("action-3", false);

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier],
                actions    : [action1, action2, action3],
            });

            await engine.start();
            await waitForInitialPoll();

            expect(action1.execute).toHaveBeenCalled();
            expect(action2.execute).toHaveBeenCalled();
            expect(action3.execute).not.toHaveBeenCalled();
        });

        // Scenario: Action error doesn't break other actions
        it("should continue executing actions if one throws", async () => {
            const entity = createMockEntity("msg-1", "Test");
            const provider = createMockProvider([entity]);

            const classifier = createMockClassifier("test-classifier", {
                classification: createClassification("spam", 0.9, "Spam", "test-classifier"),
            });

            const action1 = createMockAction("action-1", true, null, true);
            const action2 = createMockAction("action-2", true);

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier],
                actions    : [action1, action2],
            });

            await engine.start();
            await waitForInitialPoll();

            expect(action1.execute).toHaveBeenCalled();
            expect(action2.execute).toHaveBeenCalled();
        });

        // Scenario: Emits action events
        it("should emit entity:actionExecuting and entity:actionExecuted events", async () => {
            const entity = createMockEntity("msg-1", "Test");
            const provider = createMockProvider([entity]);

            const classifier = createMockClassifier("test-classifier", {
                classification: createClassification("spam", 0.9, "Spam", "test-classifier"),
            });

            const action = createMockAction("test-action", true);

            const executingHandler = vi.fn();
            const executedHandler = vi.fn();
            eventBus.subscribe("entity:actionExecuting", executingHandler);
            eventBus.subscribe("entity:actionExecuted", executedHandler);

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
                    type: "entity:actionExecuting",
                    data: expect.objectContaining({
                        actionId: "test-action",
                    }),
                })
            );

            expect(executedHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: "entity:actionExecuted",
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
            // Reset the mock to allow multiple calls
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

        // Scenario: Entity processing continues even with classifier errors
        it("should continue processing when classifier throws", async () => {
            const entity = createMockEntity("msg-1", "Test");
            const provider = createMockProvider([entity]);

            // Classifier that always throws
            const classifier: Classifier = {
                id      : "bad-classifier",
                name    : "Bad Classifier",
                evaluate: vi.fn().mockRejectedValue(new Error("Classifier error")),
            };

            const processedHandler = vi.fn();
            eventBus.subscribe("entity:processed", processedHandler);

            engine.registerDomain({
                id         : "test-domain",
                name       : "Test Domain",
                provider,
                classifiers: [classifier],
                actions    : [],
            });

            await engine.start();
            await waitForInitialPoll();

            // Entity should still be marked as processed
            expect(processedHandler).toHaveBeenCalled();
        });
    });

    describe("traceId", () => {
        // Scenario: TraceId is generated and included in events
        it("should generate unique traceId for each entity", async () => {
            const entity1 = createMockEntity("msg-1", "First");
            const entity2 = createMockEntity("msg-2", "Second");

            let callCount = 0;
            const provider: EntityProvider<Entity<object>> = {
                id         : "mock-provider",
                name       : "Mock Provider",
                initialize : vi.fn(),
                shutdown   : vi.fn(),
                getEntities: vi.fn().mockImplementation(async () => {
                    callCount++;
                    if (callCount === 1) {
                        return { entities: [entity1, entity2], hasMore: false };
                    }
                    return { entities: [], hasMore: false };
                }),
            };

            const traceIds: string[] = [];
            eventBus.subscribe("entity:received", (event) => {
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
