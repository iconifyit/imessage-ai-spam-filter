/**
 * @fileoverview Unit tests for ActionPlugin
 *
 * Tests cover:
 * - isActionPlugin type guard
 * - shouldActionExecute binding logic
 *
 * @module @tagrouter/engine/__tests__/ActionPlugin
 */

import { describe, it, expect } from "vitest";
import {
    isActionPlugin,
    shouldActionExecute,
    type ActionPlugin,
    type ClassificationOutput,
} from "../contracts/index.js";

/**
 * Create a mock action plugin for testing
 */
function createMockActionPlugin(
    id: string,
    bindings: Record<string, { minConfidence?: number }>
): ActionPlugin {
    return {
        id,
        bindings,
        handle: async () => ({ actionId: id, success: true }),
    };
}

describe("ActionPlugin", () => {
    describe("isActionPlugin", () => {
        // Scenario: Valid ActionPlugin object
        it("should return true for valid ActionPlugin", () => {
            const plugin = createMockActionPlugin("test", { spam: {} });

            expect(isActionPlugin(plugin)).toBe(true);
        });

        // Scenario: Object missing id
        it("should return false when missing id", () => {
            const invalid = {
                bindings: { spam: {} },
                handle  : async () => ({ actionId: "test", success: true }),
            };

            expect(isActionPlugin(invalid)).toBe(false);
        });

        // Scenario: Object missing bindings
        it("should return false when missing bindings", () => {
            const invalid = {
                id    : "test",
                handle: async () => ({ actionId: "test", success: true }),
            };

            expect(isActionPlugin(invalid)).toBe(false);
        });

        // Scenario: Object missing handle
        it("should return false when missing handle", () => {
            const invalid = {
                id      : "test",
                bindings: { spam: {} },
            };

            expect(isActionPlugin(invalid)).toBe(false);
        });

        // Scenario: Null value
        it("should return false for null", () => {
            expect(isActionPlugin(null)).toBe(false);
        });

        // Scenario: Undefined value
        it("should return false for undefined", () => {
            expect(isActionPlugin(undefined)).toBe(false);
        });

        // Scenario: Primitive value
        it("should return false for primitive values", () => {
            expect(isActionPlugin("string")).toBe(false);
            expect(isActionPlugin(123)).toBe(false);
            expect(isActionPlugin(true)).toBe(false);
        });

        // Scenario: id is not a string
        it("should return false when id is not a string", () => {
            const invalid = {
                id      : 123,
                bindings: { spam: {} },
                handle  : async () => ({ actionId: "test", success: true }),
            };

            expect(isActionPlugin(invalid)).toBe(false);
        });

        // Scenario: bindings is not an object
        it("should return false when bindings is not an object", () => {
            const invalid = {
                id      : "test",
                bindings: "not-an-object",
                handle  : async () => ({ actionId: "test", success: true }),
            };

            expect(isActionPlugin(invalid)).toBe(false);
        });

        // Scenario: handle is not a function
        it("should return false when handle is not a function", () => {
            const invalid = {
                id      : "test",
                bindings: { spam: {} },
                handle  : "not-a-function",
            };

            expect(isActionPlugin(invalid)).toBe(false);
        });
    });

    describe("shouldActionExecute", () => {
        // Scenario: Type matches, no minConfidence specified
        it("should return true when type matches and no minConfidence", () => {
            const action = createMockActionPlugin("delete", {
                spam: {},
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.5,
            };

            expect(shouldActionExecute(action, classification)).toBe(true);
        });

        // Scenario: Type matches, confidence meets threshold
        it("should return true when confidence meets minConfidence", () => {
            const action = createMockActionPlugin("delete", {
                spam: { minConfidence: 0.9 },
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };

            expect(shouldActionExecute(action, classification)).toBe(true);
        });

        // Scenario: Type matches, confidence equals threshold exactly
        it("should return true when confidence equals minConfidence exactly", () => {
            const action = createMockActionPlugin("delete", {
                spam: { minConfidence: 0.9 },
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.9,
            };

            expect(shouldActionExecute(action, classification)).toBe(true);
        });

        // Scenario: Type matches, confidence below threshold
        it("should return false when confidence below minConfidence", () => {
            const action = createMockActionPlugin("delete", {
                spam: { minConfidence: 0.9 },
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.85,
            };

            expect(shouldActionExecute(action, classification)).toBe(false);
        });

        // Scenario: Type does not match
        it("should return false when type does not match any binding", () => {
            const action = createMockActionPlugin("delete", {
                spam: { minConfidence: 0.9 },
            });
            const classification: ClassificationOutput = {
                type      : "personal",
                confidence: 0.99,
            };

            expect(shouldActionExecute(action, classification)).toBe(false);
        });

        // Scenario: Multiple bindings, one matches
        it("should return true when one of multiple bindings matches", () => {
            const action = createMockActionPlugin("delete", {
                spam          : { minConfidence: 0.9 },
                political_spam: { minConfidence: 0.8 },
                scam          : { minConfidence: 0.95 },
            });
            const classification: ClassificationOutput = {
                type      : "political_spam",
                confidence: 0.85,
            };

            expect(shouldActionExecute(action, classification)).toBe(true);
        });

        // Scenario: Default confidence (1.0) when classification has no confidence
        it("should use default confidence of 1.0 when not specified", () => {
            const action = createMockActionPlugin("delete", {
                spam: { minConfidence: 0.9 },
            });
            const classification: ClassificationOutput = {
                type: "spam",
                // No confidence specified, defaults to 1.0
            };

            expect(shouldActionExecute(action, classification)).toBe(true);
        });

        // Scenario: Default minConfidence (0.0) when not specified in binding
        it("should use default minConfidence of 0.0 when not specified", () => {
            const action = createMockActionPlugin("log", {
                spam: {},
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.01, // Very low confidence
            };

            expect(shouldActionExecute(action, classification)).toBe(true);
        });

        // Scenario: Confidence of 0 with minConfidence of 0
        it("should return true when both confidence and minConfidence are 0", () => {
            const action = createMockActionPlugin("log", {
                unknown: { minConfidence: 0 },
            });
            const classification: ClassificationOutput = {
                type      : "unknown",
                confidence: 0,
            };

            expect(shouldActionExecute(action, classification)).toBe(true);
        });

        // Scenario: Empty bindings object
        it("should return false when bindings is empty", () => {
            const action = createMockActionPlugin("noop", {});
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 1.0,
            };

            expect(shouldActionExecute(action, classification)).toBe(false);
        });
    });
});
