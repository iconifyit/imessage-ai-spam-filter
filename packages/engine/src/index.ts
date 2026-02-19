/**
 * @fileoverview TagRouter Engine
 *
 * Domain-agnostic classification and action orchestration engine.
 *
 * The engine provides:
 * - Pull-based entity polling from providers
 * - All classifiers run, highest confidence wins
 * - Action execution based on declarative bindings
 * - Domain registration for IoC
 *
 * @module @tagrouter/engine
 * @example
 * ```typescript
 * import {
 *     type Entity,
 *     type ClassificationPlugin,
 *     type ActionPlugin,
 *     type EntityProvider,
 *     TagRouterEngine,
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

// Classification Output
export type {
    ClassificationOutput,
    MessageType,
} from "./contracts/index.js";
export {
    createClassificationOutput,
    getEffectiveConfidence,
} from "./contracts/index.js";

// Classification Plugin
export type {
    ClassificationPlugin,
    ClassificationContext,
    PluginLogger,
} from "./contracts/index.js";
export { isClassificationPlugin } from "./contracts/index.js";

// Action Plugin
export type {
    ActionPlugin,
    ActionBinding,
    ActionContext,
    ActionResult,
} from "./contracts/index.js";
export {
    isActionPlugin,
    shouldActionExecute,
} from "./contracts/index.js";

// EntityProvider
export type {
    EntityProvider,
    FetchOptions,
    FetchResult,
} from "./contracts/index.js";

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
