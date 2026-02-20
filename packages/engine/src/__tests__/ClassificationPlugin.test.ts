/**
 * @fileoverview Unit tests for ClassificationPlugin
 *
 * Tests cover:
 * - isClassificationPlugin type guard
 *
 * @module @tagrouter/engine/__tests__/ClassificationPlugin
 */

import { describe, it, expect } from "vitest";
import {
    isClassificationPlugin,
    type ClassificationPlugin,
} from "../contracts/ClassificationPlugin.js";

/**
 * Create a mock classification plugin for testing
 */
function createMockClassificationPlugin(id: string): ClassificationPlugin {
    return {
        id,
        classify: async () => ({ type: "spam", confidence: 0.9 }),
    };
}

describe("ClassificationPlugin", () => {
    describe("isClassificationPlugin", () => {
        // Scenario: Valid ClassificationPlugin object
        it("should return true for valid ClassificationPlugin", () => {
            const plugin = createMockClassificationPlugin("test-classifier");

            expect(isClassificationPlugin(plugin)).toBe(true);
        });

        // Scenario: Valid plugin with optional fields
        it("should return true for plugin with optional name and description", () => {
            const plugin: ClassificationPlugin = {
                id         : "test-classifier",
                name       : "Test Classifier",
                description: "A test classifier",
                classify   : async () => ({ type: "spam" }),
            };

            expect(isClassificationPlugin(plugin)).toBe(true);
        });

        // Scenario: Object missing id
        it("should return false when missing id", () => {
            const invalid = {
                classify: async () => ({ type: "spam" }),
            };

            expect(isClassificationPlugin(invalid)).toBe(false);
        });

        // Scenario: Object missing classify
        it("should return false when missing classify", () => {
            const invalid = {
                id: "test",
            };

            expect(isClassificationPlugin(invalid)).toBe(false);
        });

        // Scenario: Null value
        it("should return false for null", () => {
            expect(isClassificationPlugin(null)).toBe(false);
        });

        // Scenario: Undefined value
        it("should return false for undefined", () => {
            expect(isClassificationPlugin(undefined)).toBe(false);
        });

        // Scenario: Primitive values
        it("should return false for primitive values", () => {
            expect(isClassificationPlugin("string")).toBe(false);
            expect(isClassificationPlugin(123)).toBe(false);
            expect(isClassificationPlugin(true)).toBe(false);
        });

        // Scenario: Array
        it("should return false for array", () => {
            expect(isClassificationPlugin([])).toBe(false);
            expect(isClassificationPlugin([{ id: "test", classify: () => null }])).toBe(false);
        });

        // Scenario: id is not a string
        it("should return false when id is not a string", () => {
            const invalid = {
                id      : 123,
                classify: async () => ({ type: "spam" }),
            };

            expect(isClassificationPlugin(invalid)).toBe(false);
        });

        // Scenario: classify is not a function
        it("should return false when classify is not a function", () => {
            const invalid = {
                id      : "test",
                classify: "not-a-function",
            };

            expect(isClassificationPlugin(invalid)).toBe(false);
        });

        // Scenario: Synchronous classify function is valid
        it("should return true for synchronous classify function", () => {
            const plugin = {
                id      : "sync-classifier",
                classify: () => ({ type: "spam", confidence: 1.0 }),
            };

            expect(isClassificationPlugin(plugin)).toBe(true);
        });

        // Scenario: classify that returns null is valid
        it("should return true for classify that returns null", () => {
            const plugin = {
                id      : "null-classifier",
                classify: () => null,
            };

            expect(isClassificationPlugin(plugin)).toBe(true);
        });
    });
});
