/**
 * @fileoverview Contract barrel exports
 *
 * All domain-agnostic interfaces and types that define
 * the TagRouter engine contract.
 *
 * @module @tagrouter/engine/contracts
 */

// Entity contract
export type { Entity, EntityFactory } from "./Entity.js";

// Classification contract
export type { Classification } from "./Classification.js";
export { createClassification } from "./Classification.js";

// Classifier contract
export type {
    Classifier,
    ClassifierResult,
    ClassifierContext,
    ClassifierLogger,
} from "./Classifier.js";
export { shouldHalt } from "./Classifier.js";

// EntityProvider contract
export type {
    EntityProvider,
    FetchOptions,
    FetchResult,
} from "./EntityProvider.js";

// Action contract
export type {
    Action,
    ActionResult,
    ActionContext,
    ActionLogger,
    TypeMappedAction,
} from "./Action.js";
export { isTypeMappedAction } from "./Action.js";

// EventBus contract
export type {
    EventBus,
    EventPayload,
    EventHandler,
    EventType,
    LifecycleEventType,
    ProcessingEventType,
    Subscription,
} from "./EventBus.js";
export { createEvent } from "./EventBus.js";
