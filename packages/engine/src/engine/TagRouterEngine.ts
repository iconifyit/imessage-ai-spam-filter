/**
 * @fileoverview TagRouterEngine
 *
 * The core orchestration engine for TagRouter.
 *
 * Pipeline flow:
 * 1. Message ingested (immutable)
 * 2. All classifiers run (not chain-of-responsibility)
 * 3. Highest confidence result selected
 * 4. Actions with matching bindings execute
 *
 * Design principles:
 * - Domain-agnostic: knows nothing about SMS, Gmail, etc.
 * - Plugin-based: classifiers and actions are plugins
 * - Observable: emits events at each lifecycle stage
 * - Pull-based: periodically polls providers for entities
 *
 * @module @tagrouter/engine/engine/TagRouterEngine
 */

import type { Entity } from "../contracts/Entity.js";
import type {
    ClassificationOutput,
    MessageType,
} from "../contracts/ClassificationOutput.js";
import {
    getEffectiveConfidence,
} from "../contracts/ClassificationOutput.js";
import type {
    ClassificationPlugin,
    ClassificationContext,
    PluginLogger,
} from "../contracts/ClassificationPlugin.js";
import type {
    ActionPlugin,
    ActionContext,
    ActionResult,
} from "../contracts/ActionPlugin.js";
import { shouldActionExecute } from "../contracts/ActionPlugin.js";
import type { EntityProvider } from "../contracts/EntityProvider.js";
import type { EventBus, EventPayload } from "../contracts/EventBus.js";
import { createEvent } from "../contracts/EventBus.js";
import { InMemoryEventBus } from "../impl/InMemoryEventBus.js";

/**
 * Domain registration - all components needed for a domain.
 */
export interface DomainRegistration {
    /** Unique identifier for this domain */
    readonly id: string;

    /** Human-readable name */
    readonly name: string;

    /** Entity provider for this domain */
    readonly provider: EntityProvider<Entity<object>>;

    /** Classification plugins to evaluate messages */
    readonly classifiers: ClassificationPlugin[];

    /** Action plugins to execute based on classification */
    readonly actions: ActionPlugin[];

    /** Optional domain-specific configuration */
    readonly config?: Record<string, unknown>;
}

/**
 * Engine configuration options.
 */
export interface EngineConfig {
    /** Polling interval in milliseconds (default: 30000) */
    readonly pollingInterval?: number;

    /** Maximum entities to fetch per poll (default: 10) */
    readonly batchSize?: number;

    /** Custom EventBus (default: InMemoryEventBus) */
    readonly eventBus?: EventBus;

    /** Logger for engine operations */
    readonly logger?: EngineLogger;
}

/**
 * Logger interface for the engine.
 */
export interface EngineLogger {
    debug(message: string, data?: Record<string, unknown>): void;
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Default console logger.
 */
const defaultLogger: EngineLogger = {
    debug: (msg, data) => console.debug(`[DEBUG] ${msg}`, data ?? ""),
    info : (msg, data) => console.info(`[INFO] ${msg}`, data ?? ""),
    warn : (msg, data) => console.warn(`[WARN] ${msg}`, data ?? ""),
    error: (msg, data) => console.error(`[ERROR] ${msg}`, data ?? ""),
};

/**
 * Generate a unique trace ID for message processing.
 */
function generateTraceId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `tr_${timestamp}_${random}`;
}

/**
 * Internal result from running all classifiers.
 * Includes the source classifier ID for debugging.
 */
interface ClassifierResultWithSource {
    readonly output: ClassificationOutput;
    readonly classifierId: string;
}

/**
 * TagRouterEngine - The core orchestration engine.
 *
 * Pipeline:
 * 1. Poll provider for messages
 * 2. For each message, run ALL classifiers
 * 3. Select highest confidence result
 * 4. Execute actions where bindings match
 *
 * @example
 * ```typescript
 * const engine = new TagRouterEngine({ pollingInterval: 30000 });
 *
 * // Register SMS domain
 * engine.registerDomain({
 *     id: "sms",
 *     name: "SMS Spam Killer",
 *     provider: new IMessageEntityProvider(),
 *     classifiers: [regexClassifier, aiClassifier],
 *     actions: [deleteAction, logAction],
 * });
 *
 * // Subscribe to events
 * engine.eventBus.subscribe("message:classified", (event) => {
 *     console.log("Classified:", event.data);
 * });
 *
 * await engine.start();
 * ```
 */
export class TagRouterEngine {
    private readonly config: Required<Omit<EngineConfig, "eventBus" | "logger">> & {
        eventBus: EventBus;
        logger: EngineLogger;
    };

    private readonly domains: Map<string, DomainRegistration> = new Map();
    private running = false;
    private pollTimer: NodeJS.Timeout | null = null;

    /** Public access to the event bus for external subscriptions */
    public readonly eventBus: EventBus;

    constructor(config: EngineConfig = {}) {
        this.eventBus = config.eventBus ?? new InMemoryEventBus();

        this.config = {
            pollingInterval: config.pollingInterval ?? 30000,
            batchSize      : config.batchSize ?? 10,
            eventBus       : this.eventBus,
            logger         : config.logger ?? defaultLogger,
        };
    }

    /**
     * Register a domain with the engine.
     *
     * @param domain - Domain registration with provider, classifiers, and actions
     * @throws Error if domain with same ID already registered
     */
    registerDomain(domain: DomainRegistration): void {
        if (this.domains.has(domain.id)) {
            throw new Error(`Domain already registered: ${domain.id}`);
        }

        this.domains.set(domain.id, domain);
        this.config.logger.info("Domain registered", {
            domainId   : domain.id,
            name       : domain.name,
            classifiers: domain.classifiers.length,
            actions    : domain.actions.length,
        });
    }

    /**
     * Unregister a domain from the engine.
     *
     * @param domainId - The domain ID to unregister
     */
    unregisterDomain(domainId: string): void {
        if (this.domains.delete(domainId)) {
            this.config.logger.info("Domain unregistered", { domainId });
        }
    }

    /**
     * Start the engine.
     *
     * Initializes all providers and starts the polling loop.
     */
    async start(): Promise<void> {
        if (this.running) {
            this.config.logger.warn("Engine already running");
            return;
        }

        this.emit(createEvent("engine:starting"));
        this.config.logger.info("Engine starting...");

        // Initialize all providers
        for (const domain of this.domains.values()) {
            try {
                if (domain.provider.initialize) {
                    await domain.provider.initialize();
                }
                this.config.logger.info("Provider initialized", {
                    domainId  : domain.id,
                    providerId: domain.provider.id,
                });
            }
            catch (error) {
                this.config.logger.error("Provider initialization failed", {
                    domainId: domain.id,
                    error   : error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        }

        this.running = true;

        // Start polling loop
        this.poll();
        this.pollTimer = setInterval(() => this.poll(), this.config.pollingInterval);

        this.emit(createEvent("engine:started", {
            domains        : Array.from(this.domains.keys()),
            pollingInterval: this.config.pollingInterval,
        }));

        this.config.logger.info("Engine started", {
            domains        : this.domains.size,
            pollingInterval: this.config.pollingInterval,
        });
    }

    /**
     * Stop the engine.
     *
     * Stops the polling loop and shuts down all providers.
     */
    async stop(): Promise<void> {
        if (!this.running) {
            return;
        }

        this.emit(createEvent("engine:stopping"));
        this.config.logger.info("Engine stopping...");

        this.running = false;

        // Stop polling
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }

        // Shutdown all providers
        for (const domain of this.domains.values()) {
            try {
                if (domain.provider.shutdown) {
                    await domain.provider.shutdown();
                }
            }
            catch (error) {
                this.config.logger.error("Provider shutdown error", {
                    domainId: domain.id,
                    error   : error instanceof Error ? error.message : String(error),
                });
            }
        }

        this.emit(createEvent("engine:stopped"));
        this.config.logger.info("Engine stopped");
    }

    /**
     * Check if the engine is running.
     */
    get isRunning(): boolean {
        return this.running;
    }

    /**
     * Poll all domains for new messages.
     */
    private async poll(): Promise<void> {
        for (const domain of this.domains.values()) {
            try {
                await this.pollDomain(domain);
            }
            catch (error) {
                this.config.logger.error("Domain poll error", {
                    domainId: domain.id,
                    error   : error instanceof Error ? error.message : String(error),
                });
                this.emit(createEvent("engine:error", {
                    domainId: domain.id,
                    error   : error instanceof Error ? error.message : String(error),
                }));
            }
        }
    }

    /**
     * Poll a single domain for messages and process them.
     */
    private async pollDomain(domain: DomainRegistration): Promise<void> {
        const result = await domain.provider.getEntities({
            limit: this.config.batchSize,
        });

        if (result.entities.length === 0) {
            return;
        }

        this.config.logger.debug("Fetched messages", {
            domainId: domain.id,
            count   : result.entities.length,
        });

        for (const message of result.entities) {
            await this.processMessage(domain, message);
        }
    }

    /**
     * Process a single message through the classification and action pipeline.
     *
     * Pipeline:
     * 1. Assign trace ID
     * 2. Emit message:received
     * 3. Run ALL classifiers, collect results
     * 4. Select highest confidence result
     * 5. Emit message:classified
     * 6. Execute actions with matching bindings
     * 7. Emit message:processed
     */
    async processMessage(domain: DomainRegistration, message: Entity<object>): Promise<void> {
        const traceId = generateTraceId();
        const startTime = Date.now();

        this.emit(createEvent("message:received", {
            domainId : domain.id,
            messageId: message.id,
        }, traceId));

        try {
            // Run classification pipeline
            this.emit(createEvent("message:classifying", {
                domainId   : domain.id,
                messageId  : message.id,
                classifiers: domain.classifiers.map(c => c.id),
            }, traceId));

            const classificationResult = await this.runClassifiers(domain, message, traceId);

            if (!classificationResult) {
                // No classifier matched
                this.emit(createEvent("message:unclassified", {
                    domainId : domain.id,
                    messageId: message.id,
                }, traceId));

                this.config.logger.debug("Message unclassified (no match)", {
                    domainId : domain.id,
                    messageId: message.id,
                    traceId,
                });
                return;
            }

            this.emit(createEvent("message:classified", {
                domainId    : domain.id,
                messageId   : message.id,
                type        : classificationResult.output.type,
                confidence  : getEffectiveConfidence(classificationResult.output),
                tags        : classificationResult.output.tags,
                classifierId: classificationResult.classifierId,
            }, traceId));

            // Execute actions
            await this.executeActions(domain, message, classificationResult.output, traceId);

            const duration = Date.now() - startTime;
            this.emit(createEvent("message:processed", {
                domainId : domain.id,
                messageId: message.id,
                type     : classificationResult.output.type,
                duration,
            }, traceId));

            this.config.logger.debug("Message processed", {
                domainId : domain.id,
                messageId: message.id,
                type     : classificationResult.output.type,
                traceId,
                duration,
            });
        }
        catch (error) {
            this.emit(createEvent("message:error", {
                domainId : domain.id,
                messageId: message.id,
                error    : error instanceof Error ? error.message : String(error),
            }, traceId));

            this.config.logger.error("Message processing error", {
                domainId : domain.id,
                messageId: message.id,
                traceId,
                error    : error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Run ALL classifiers and select highest confidence result.
     *
     * Unlike chain-of-responsibility, all classifiers run independently.
     * The result with highest confidence wins.
     */
    private async runClassifiers(
        domain: DomainRegistration,
        message: Entity<object>,
        traceId: string
    ): Promise<ClassifierResultWithSource | null> {
        const results: ClassifierResultWithSource[] = [];

        const baseContext: Omit<ClassificationContext, "logger"> = {
            config : domain.config ?? {},
            traceId,
        };

        // Run ALL classifiers (not chain-of-responsibility)
        const classifierPromises = domain.classifiers.map(async (classifier) => {
            try {
                const context: ClassificationContext = {
                    ...baseContext,
                    logger: this.createPluginLogger(domain.id, classifier.id, traceId),
                };

                const output = await classifier.classify(message, context);

                if (output) {
                    return {
                        output,
                        classifierId: classifier.id,
                    };
                }
            }
            catch (error) {
                this.config.logger.error("Classifier error", {
                    domainId    : domain.id,
                    classifierId: classifier.id,
                    messageId   : message.id,
                    error       : error instanceof Error ? error.message : String(error),
                });
            }
            return null;
        });

        // Wait for all classifiers to complete
        const classifierResults = await Promise.all(classifierPromises);

        // Collect non-null results
        for (const result of classifierResults) {
            if (result) {
                results.push(result);
            }
        }

        if (results.length === 0) {
            return null;
        }

        // Select highest confidence result
        let winner = results[0];
        let winnerConfidence = getEffectiveConfidence(winner.output);

        for (let i = 1; i < results.length; i++) {
            const confidence = getEffectiveConfidence(results[i].output);
            if (confidence > winnerConfidence) {
                winner = results[i];
                winnerConfidence = confidence;
            }
        }

        this.config.logger.debug("Classification resolved", {
            domainId      : domain.id,
            messageId     : message.id,
            totalResults  : results.length,
            winningType   : winner.output.type,
            winnerConfidence,
            classifierId  : winner.classifierId,
        });

        return winner;
    }

    /**
     * Execute actions that match the classification via their bindings.
     */
    private async executeActions(
        domain: DomainRegistration,
        message: Entity<object>,
        classification: ClassificationOutput,
        traceId: string
    ): Promise<void> {
        for (const action of domain.actions) {
            // Check if action should execute based on bindings
            if (!shouldActionExecute(action, classification)) {
                continue;
            }

            this.emit(createEvent("message:actionExecuting", {
                domainId : domain.id,
                messageId: message.id,
                actionId : action.id,
                type     : classification.type,
            }, traceId));

            try {
                const context: ActionContext = {
                    message,
                    classification,
                    config : domain.config ?? {},
                    logger : this.createPluginLogger(domain.id, action.id, traceId),
                    traceId,
                };

                const result: ActionResult = await action.handle(context);

                this.emit(createEvent("message:actionExecuted", {
                    domainId : domain.id,
                    messageId: message.id,
                    actionId : action.id,
                    success  : result.success,
                    error    : result.error,
                }, traceId));

                if (!result.success) {
                    this.config.logger.warn("Action failed", {
                        domainId : domain.id,
                        actionId : action.id,
                        messageId: message.id,
                        error    : result.error,
                    });
                }
            }
            catch (error) {
                this.config.logger.error("Action execution error", {
                    domainId : domain.id,
                    actionId : action.id,
                    messageId: message.id,
                    error    : error instanceof Error ? error.message : String(error),
                });

                this.emit(createEvent("message:actionError", {
                    domainId : domain.id,
                    messageId: message.id,
                    actionId : action.id,
                    error    : error instanceof Error ? error.message : String(error),
                }, traceId));
            }
        }
    }

    /**
     * Emit an event to the event bus.
     */
    private emit(event: EventPayload): void {
        this.eventBus.emit(event);
    }

    /**
     * Create a logger for a plugin (classifier or action).
     */
    private createPluginLogger(domainId: string, pluginId: string, traceId: string): PluginLogger {
        return {
            debug: (msg, data) => this.config.logger.debug(`[${domainId}:${pluginId}] ${msg}`, { ...data, traceId }),
            info : (msg, data) => this.config.logger.info(`[${domainId}:${pluginId}] ${msg}`, { ...data, traceId }),
            warn : (msg, data) => this.config.logger.warn(`[${domainId}:${pluginId}] ${msg}`, { ...data, traceId }),
            error: (msg, data) => this.config.logger.error(`[${domainId}:${pluginId}] ${msg}`, { ...data, traceId }),
        };
    }
}
