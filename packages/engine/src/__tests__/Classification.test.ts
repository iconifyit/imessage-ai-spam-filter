/**
 * @fileoverview Unit tests for Classification factory and utilities
 *
 * Tests cover:
 * - createClassification factory function
 * - Immutability (Object.freeze)
 * - Timestamp generation
 *
 * @module @tagrouter/engine/__tests__/Classification
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClassification } from "../contracts/Classification.js";

describe("createClassification", () => {
    // Freeze time for consistent timestamp testing
    const frozenTime = new Date("2025-01-15T10:30:00.000Z");

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(frozenTime);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // Scenario: Create a basic classification with all required fields
    it("should create a classification with all provided fields", () => {
        const classification = createClassification(
            "spam",
            0.95,
            "Contains known spam patterns",
            "spam-classifier"
        );

        expect(classification.type).toBe("spam");
        expect(classification.confidence).toBe(0.95);
        expect(classification.reason).toBe("Contains known spam patterns");
        expect(classification.classifierId).toBe("spam-classifier");
    });

    // Scenario: Timestamp is set to current time
    it("should set timestamp to current ISO time", () => {
        const classification = createClassification(
            "personal",
            0.8,
            "From known contact",
            "contact-classifier"
        );

        expect(classification.timestamp).toBe("2025-01-15T10:30:00.000Z");
    });

    // Scenario: Classification is immutable (frozen)
    it("should return a frozen object", () => {
        const classification = createClassification(
            "marketing",
            0.7,
            "Contains promotional content",
            "marketing-classifier"
        );

        expect(Object.isFrozen(classification)).toBe(true);
    });

    // Scenario: Attempting to modify frozen object throws in strict mode
    it("should not allow modification of properties", () => {
        const classification = createClassification(
            "spam",
            0.9,
            "Test reason",
            "test-classifier"
        );

        // In strict mode, this would throw. In non-strict, it silently fails.
        // We test that the value doesn't change.
        expect(() => {
            (classification as { type: string }).type = "not-spam";
        }).toThrow();

        expect(classification.type).toBe("spam");
    });

    // Scenario: Zero confidence is valid
    it("should accept zero confidence", () => {
        const classification = createClassification(
            "unknown",
            0,
            "Unable to classify",
            "fallback-classifier"
        );

        expect(classification.confidence).toBe(0);
    });

    // Scenario: Full confidence is valid
    it("should accept full confidence (1.0)", () => {
        const classification = createClassification(
            "spam",
            1.0,
            "Definitely spam",
            "certainty-classifier"
        );

        expect(classification.confidence).toBe(1.0);
    });

    // Scenario: Empty reason is valid
    it("should accept empty reason string", () => {
        const classification = createClassification(
            "spam",
            0.5,
            "",
            "silent-classifier"
        );

        expect(classification.reason).toBe("");
    });

    // Scenario: Different classifications have different timestamps when time advances
    it("should have different timestamps when created at different times", () => {
        const classification1 = createClassification(
            "spam",
            0.9,
            "First",
            "classifier-1"
        );

        // Advance time by 5 seconds
        vi.advanceTimersByTime(5000);

        const classification2 = createClassification(
            "spam",
            0.9,
            "Second",
            "classifier-2"
        );

        expect(classification1.timestamp).toBe("2025-01-15T10:30:00.000Z");
        expect(classification2.timestamp).toBe("2025-01-15T10:30:05.000Z");
    });
});
