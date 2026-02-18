/**
 * @fileoverview TagRouterEngine
 *
 * The core orchestration engine for TagRouter.
 *
 * Responsibilities:
 * - Daemon lifecycle (start/stop)
 * - Domain registration
 * - Entity processing pipeline
 * - Event emission for observability
 *
 * Design principles:
 * - Domain-agnostic: knows nothing about SMS, Gmail, etc.
 * - Contract-driven: operates only through defined interfaces
 * - Observable: emits events at each lifecycle stage
 * - Pull-based: periodically polls providers for entities
 *
 * @module @tagrouter/engine/engine/TagRouterEngine
 */

import type { Entity } from "../contracts/Entity.js";
import type { Classification } from "../contracts/Classification.js";
import type {
    Classifier,
    ClassifierContext,
    ClassifierLogger,
    ClassifierResult,
} from "../contracts/Classifier.js";
import type { EntityProvider, FetchResult } from "../contracts/EntityProvider.js";
import type { Action, ActionContext, ActionLogger } from "../contracts/Action.js";
import type { EventBus, EventPayload } from "../contracts/EventBus.js";
import { createEvent } from "../contracts/EventBus.js";
import { shouldHalt } from "../contracts/Classifier.js";
import { InMemoryEventBus } from "../impl/InMemoryEventBus.js";

/**
 * Domain registration - all components needed for a domain.
 *
 * The provider, classifiers, and actions operate on Entity<object>,
 * allowing domain-specific entity types (e.g., SMSMessage) to be used.
 */
export interface DomainRegistration {
    /** Unique identifier for this domain */
    readonly id: string;

    /** Human-readable name */
    readonly name: string;

    /** Entity provider for this domain (any entity type extending Entity<object>) */
    readonly provider: EntityProvider<Entity<object>>;

    /** Classifiers to evaluate entities (executed in order) */
    readonly classifiers: Classifier[];

    /** Actions to execute based on classification */
    readonly actions: Action[];

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
 * Generate a unique trace ID for entity processing.
 */
function generateTraceId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `tr_${timestamp}_${random}`;
}

/**
 * TagRouterEngine - The core orchestration engine.
 *
 * The engine:
 * 1. Accepts domain registrations (providers, classifiers, actions)
 * 2. Polls providers for entities on an interval
 * 3. Runs entities through the classification pipeline
 * 4. Executes matching actions
 * 5. Emits events at each stage for observability
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
 *     classifiers: [new SMSClassifier(config)],
 *     actions: [new DeleteSpamAction(), new NotifySpamAction()],
 * });
 *
 * // Subscribe to events
 * engine.eventBus.subscribe("entity:classified", (event) => {
 *     console.log("Classified:", event.data);
 * });
 *
 * // Start the engine
 * await engine.start();
 *
 * // Later: stop
 * await engine.stop();
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
     * Poll all domains for new entities.
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
     * Poll a single domain for entities and process them.
     */
    private async pollDomain(domain: DomainRegistration): Promise<void> {
        const result = await domain.provider.getEntities({
            limit: this.config.batchSize,
        });

        if (result.entities.length === 0) {
            return;
        }

        this.config.logger.debug("Fetched entities", {
            domainId: domain.id,
            count   : result.entities.length,
        });

        for (const entity of result.entities) {
            await this.processEntity(domain, entity);
        }
    }

    /**
     * Process a single entity through the classification and action pipeline.
     *
     * Pipeline:
     * 1. Assign trace ID
     * 2. Emit entity:received
     * 3. Run classifiers (chain of responsibility)
     * 4. Emit entity:classified
     * 5. Execute matching actions
     * 6. Emit entity:processed
     */
    async processEntity(domain: DomainRegistration, entity: Entity<object>): Promise<void> {
        const traceId = generateTraceId();
        const startTime = Date.now();

        // Attach trace ID to entity if mutable (or track separately)
        const tracedEntity = { ...entity, traceId } as Entity<object>;

        this.emit(createEvent("entity:received", {
            domainId: domain.id,
            entityId: entity.id,
        }, traceId));

        try {
            // Run classification pipeline
            this.emit(createEvent("entity:classifying", {
                domainId   : domain.id,
                entityId   : entity.id,
                classifiers: domain.classifiers.map(c => c.id),
            }, traceId));

            const classifications = await this.runClassifiers(domain, tracedEntity, traceId);

            this.emit(createEvent("entity:classified", {
                domainId       : domain.id,
                entityId       : entity.id,
                classifications: classifications.map(c => ({ type: c.type, confidence: c.confidence })),
            }, traceId));

            // Execute actions
            if (classifications.length > 0) {
                await this.executeActions(domain, tracedEntity, classifications, traceId);
            }

            const duration = Date.now() - startTime;
            this.emit(createEvent("entity:processed", {
                domainId: domain.id,
                entityId: entity.id,
                duration,
            }, traceId));

            this.config.logger.debug("Entity processed", {
                domainId: domain.id,
                entityId: entity.id,
                traceId,
                duration,
            });
        }
        catch (error) {
            this.emit(createEvent("entity:error", {
                domainId: domain.id,
                entityId: entity.id,
                error   : error instanceof Error ? error.message : String(error),
            }, traceId));

            this.config.logger.error("Entity processing error", {
                domainId: domain.id,
                entityId: entity.id,
                traceId,
                error   : error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Run classifiers in chain-of-responsibility pattern.
     */
    private async runClassifiers(
        domain: DomainRegistration,
        entity: Entity<object>,
        traceId: string
    ): Promise<Classification[]> {
        const classifications: Classification[] = [];

        const context: ClassifierContext = {
            config                 : domain.config ?? {},
            logger                 : this.createClassifierLogger(domain.id, traceId),
            previousClassifications: [],
        };

        for (const classifier of domain.classifiers) {
            try {
                const result = await classifier.evaluate(entity, {
                    ...context,
                    previousClassifications: [...classifications],
                });

                if (result) {
                    classifications.push(result.classification);

                    // Check for halt signal
                    if (shouldHalt(result)) {
                        this.config.logger.debug("Classifier chain halted", {
                            domainId    : domain.id,
                            classifierId: classifier.id,
                            entityId    : entity.id,
                        });
                        break;
                    }
                }
            }
            catch (error) {
                this.config.logger.error("Classifier error", {
                    domainId    : domain.id,
                    classifierId: classifier.id,
                    entityId    : entity.id,
                    error       : error instanceof Error ? error.message : String(error),
                });
            }
        }

        return classifications;
    }

    /**
     * Execute actions that should run based on classifications.
     */
    private async executeActions(
        domain: DomainRegistration,
        entity: Entity<object>,
        classifications: Classification[],
        traceId: string
    ): Promise<void> {
        // Use the last (most specific) classification for action selection
        const primaryClassification = classifications[classifications.length - 1];

        for (const action of domain.actions) {
            if (action.shouldExecute(primaryClassification)) {
                this.emit(createEvent("entity:actionExecuting", {
                    domainId: domain.id,
                    entityId: entity.id,
                    actionId: action.id,
                }, traceId));

                try {
                    const context: ActionContext = {
                        entity,
                        classifications,
                        classification: primaryClassification,
                        config        : domain.config ?? {},
                        logger        : this.createActionLogger(domain.id, action.id, traceId),
                    };

                    const result = await action.execute(context);

                    this.emit(createEvent("entity:actionExecuted", {
                        domainId: domain.id,
                        entityId: entity.id,
                        actionId: action.id,
                        success : result.success,
                        error   : result.error,
                    }, traceId));

                    if (!result.success) {
                        this.config.logger.warn("Action failed", {
                            domainId: domain.id,
                            actionId: action.id,
                            entityId: entity.id,
                            error   : result.error,
                        });
                    }
                }
                catch (error) {
                    this.config.logger.error("Action execution error", {
                        domainId: domain.id,
                        actionId: action.id,
                        entityId: entity.id,
                        error   : error instanceof Error ? error.message : String(error),
                    });
                }
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
     * Create a logger for a classifier.
     */
    private createClassifierLogger(domainId: string, traceId: string): ClassifierLogger {
        return {
            debug: (msg, data) => this.config.logger.debug(`[${domainId}] ${msg}`, { ...data, traceId }),
            info : (msg, data) => this.config.logger.info(`[${domainId}] ${msg}`, { ...data, traceId }),
            warn : (msg, data) => this.config.logger.warn(`[${domainId}] ${msg}`, { ...data, traceId }),
            error: (msg, data) => this.config.logger.error(`[${domainId}] ${msg}`, { ...data, traceId }),
        };
    }

    /**
     * Create a logger for an action.
     */
    private createActionLogger(domainId: string, actionId: string, traceId: string): ActionLogger {
        return {
            debug: (msg, data) => this.config.logger.debug(`[${domainId}:${actionId}] ${msg}`, { ...data, traceId }),
            info : (msg, data) => this.config.logger.info(`[${domainId}:${actionId}] ${msg}`, { ...data, traceId }),
            warn : (msg, data) => this.config.logger.warn(`[${domainId}:${actionId}] ${msg}`, { ...data, traceId }),
            error: (msg, data) => this.config.logger.error(`[${domainId}:${actionId}] ${msg}`, { ...data, traceId }),
        };
    }
}
