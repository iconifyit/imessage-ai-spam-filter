/**
 * @fileoverview Unit tests for ClassificationOutput
 *
 * Tests cover:
 * - createClassificationOutput factory function
 * - getEffectiveConfidence helper
 * - Immutability of created objects
 *
 * @module @tagrouter/engine/__tests__/ClassificationOutput
 */

import { describe, it, expect } from "vitest";
import {
    createClassificationOutput,
    getEffectiveConfidence,
    type ClassificationOutput,
} from "../contracts/ClassificationOutput.js";

describe("ClassificationOutput", () => {
    describe("createClassificationOutput", () => {
        // Scenario: Create with only type (required field)
        it("should create output with only type", () => {
            const output = createClassificationOutput("spam");

            expect(output.type).toBe("spam");
            expect(output.confidence).toBeUndefined();
            expect(output.tags).toBeUndefined();
        });

        // Scenario: Create with type and confidence
        it("should create output with type and confidence", () => {
            const output = createClassificationOutput("marketing", { confidence: 0.85 });

            expect(output.type).toBe("marketing");
            expect(output.confidence).toBe(0.85);
            expect(output.tags).toBeUndefined();
        });

        // Scenario: Create with type and tags
        it("should create output with type and tags", () => {
            const output = createClassificationOutput("personal", {
                tags: ["friend", "family"],
            });

            expect(output.type).toBe("personal");
            expect(output.confidence).toBeUndefined();
            expect(output.tags).toEqual(["friend", "family"]);
        });

        // Scenario: Create with all fields
        it("should create output with all fields", () => {
            const output = createClassificationOutput("political_spam", {
                confidence: 0.95,
                tags      : ["donation", "campaign"],
            });

            expect(output.type).toBe("political_spam");
            expect(output.confidence).toBe(0.95);
            expect(output.tags).toEqual(["donation", "campaign"]);
        });

        // Scenario: Output is immutable (frozen)
        it("should return a frozen object", () => {
            const output = createClassificationOutput("spam", { confidence: 0.9 });

            expect(Object.isFrozen(output)).toBe(true);
        });

        // Scenario: Tags array is also frozen
        it("should freeze the tags array", () => {
            const output = createClassificationOutput("spam", {
                tags: ["test"],
            });

            expect(Object.isFrozen(output.tags)).toBe(true);
        });

        // Scenario: Confidence of 0 is preserved (not treated as falsy)
        it("should preserve confidence of 0", () => {
            const output = createClassificationOutput("unknown", { confidence: 0 });

            expect(output.confidence).toBe(0);
        });

        // Scenario: Empty tags array is preserved
        it("should preserve empty tags array", () => {
            const output = createClassificationOutput("spam", { tags: [] });

            expect(output.tags).toEqual([]);
        });
    });

    describe("getEffectiveConfidence", () => {
        // Scenario: Returns explicit confidence when provided
        it("should return explicit confidence", () => {
            const output: ClassificationOutput = {
                type      : "spam",
                confidence: 0.75,
            };

            expect(getEffectiveConfidence(output)).toBe(0.75);
        });

        // Scenario: Returns 1.0 when confidence is undefined
        it("should return 1.0 when confidence is undefined", () => {
            const output: ClassificationOutput = {
                type: "spam",
            };

            expect(getEffectiveConfidence(output)).toBe(1.0);
        });

        // Scenario: Returns 0 when confidence is explicitly 0
        it("should return 0 when confidence is explicitly 0", () => {
            const output: ClassificationOutput = {
                type      : "unknown",
                confidence: 0,
            };

            expect(getEffectiveConfidence(output)).toBe(0);
        });

        // Scenario: Handles edge case confidence values
        it("should handle confidence of 1.0", () => {
            const output: ClassificationOutput = {
                type      : "spam",
                confidence: 1.0,
            };

            expect(getEffectiveConfidence(output)).toBe(1.0);
        });

        // Scenario: Handles very small confidence values
        it("should handle very small confidence values", () => {
            const output: ClassificationOutput = {
                type      : "spam",
                confidence: 0.001,
            };

            expect(getEffectiveConfidence(output)).toBe(0.001);
        });
    });
});
