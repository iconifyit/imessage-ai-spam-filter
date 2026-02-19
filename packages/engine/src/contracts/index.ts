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

// Classification output
export type {
    ClassificationOutput,
    MessageType,
} from "./ClassificationOutput.js";
export {
    createClassificationOutput,
    getEffectiveConfidence,
} from "./ClassificationOutput.js";

// Classification plugin contract
export type {
    ClassificationPlugin,
    ClassificationContext,
    PluginLogger,
} from "./ClassificationPlugin.js";
export { isClassificationPlugin } from "./ClassificationPlugin.js";

// Action plugin contract
export type {
    ActionPlugin,
    ActionBinding,
    ActionContext,
    ActionResult,
} from "./ActionPlugin.js";
export {
    isActionPlugin,
    shouldActionExecute,
} from "./ActionPlugin.js";

// EntityProvider contract
export type {
    EntityProvider,
    FetchOptions,
    FetchResult,
} from "./EntityProvider.js";

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
