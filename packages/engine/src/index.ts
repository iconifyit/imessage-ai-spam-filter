/**
 * @fileoverview TagRouter Engine
 *
 * Domain-agnostic classification and action orchestration engine.
 *
 * The engine provides:
 * - Pull-based entity polling from providers
 * - Chain of Responsibility classification
 * - Self-selecting action execution
 * - Domain registration for IoC
 *
 * @module @tagrouter/engine
 * @example
 * ```typescript
 * import {
 *     type Entity,
 *     type Classifier,
 *     type Action,
 *     type EntityProvider,
 *     createClassification,
 * } from "@tagrouter/engine";
 *
 * // Define domain entities, classifiers, providers, and actions
 * // Register with the engine
 * // Engine orchestrates the pipeline
 * ```
 */

// ============================================================================
// Contract exports
// ============================================================================

// Entity
export type { Entity, EntityFactory } from "./contracts/index.js";

// Classification
export type { Classification } from "./contracts/index.js";
export { createClassification } from "./contracts/index.js";

// Classifier
export type {
    Classifier,
    ClassifierResult,
    ClassifierContext,
    ClassifierLogger,
} from "./contracts/index.js";
export { shouldHalt } from "./contracts/index.js";

// EntityProvider
export type {
    EntityProvider,
    FetchOptions,
    FetchResult,
} from "./contracts/index.js";

// Action
export type {
    Action,
    ActionResult,
    ActionContext,
    ActionLogger,
    TypeMappedAction,
} from "./contracts/index.js";
export { isTypeMappedAction } from "./contracts/index.js";

// EventBus
export type {
    EventBus,
    EventPayload,
    EventHandler,
    EventType,
    LifecycleEventType,
    ProcessingEventType,
    Subscription,
} from "./contracts/index.js";
export { createEvent } from "./contracts/index.js";

// ============================================================================
// Implementation exports
// ============================================================================

export { InMemoryEventBus } from "./impl/index.js";

// ============================================================================
// Engine exports
// ============================================================================

export {
    TagRouterEngine,
    type DomainRegistration,
    type EngineConfig,
    type EngineLogger,
} from "./engine/index.js";
