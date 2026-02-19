/**
 * @fileoverview Unit tests for loadTypes configuration module
 *
 * Tests cover:
 * - loadTypeDefinitions function
 * - loadTypeDefinitionsWithFallback function
 * - getDefaultTypes function
 * - Error handling for invalid files
 * - YAML parsing and validation
 *
 * @module config/__tests__/loadTypes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    loadTypeDefinitions,
    loadTypeDefinitionsWithFallback,
    getDefaultTypes,
} from "../config/loadTypes.js";

// Mock the fs module
vi.mock("fs", () => ({
    readFileSync: vi.fn(),
    existsSync  : vi.fn(),
}));

import { readFileSync, existsSync } from "fs";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe("loadTypes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("loadTypeDefinitions", () => {
        // Scenario: Load valid types.yml file with multiple types
        it("should load and parse valid YAML file with multiple types", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
types:
  - id: spam
    description: Spam and scam messages
  - id: personal
    description: Personal messages from contacts
  - id: promotional
    description: Marketing messages from businesses
`);

            const types = loadTypeDefinitions("/path/to/types.yml");

            expect(types).toHaveLength(3);
            expect(types[0]).toEqual({
                id         : "spam",
                description: "Spam and scam messages",
            });
            expect(types[1]).toEqual({
                id         : "personal",
                description: "Personal messages from contacts",
            });
            expect(types[2]).toEqual({
                id         : "promotional",
                description: "Marketing messages from businesses",
            });
        });

        // Scenario: Load type with examples
        it("should include examples when present in YAML", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
types:
  - id: spam
    description: Spam messages
    examples:
      - "You won $1,000,000!"
      - "Click here to claim your prize"
      - "URGENT: Your account has been compromised"
`);

            const types = loadTypeDefinitions("/path/to/types.yml");

            expect(types).toHaveLength(1);
            expect(types[0].examples).toEqual([
                "You won $1,000,000!",
                "Click here to claim your prize",
                "URGENT: Your account has been compromised",
            ]);
        });

        // Scenario: Load type without examples
        it("should not include examples when absent in YAML", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
types:
  - id: unknown
    description: Cannot classify
`);

            const types = loadTypeDefinitions("/path/to/types.yml");

            expect(types[0]).toEqual({
                id         : "unknown",
                description: "Cannot classify",
            });
            expect(types[0]).not.toHaveProperty("examples");
        });

        // Scenario: File does not exist
        it("should throw error when file does not exist", () => {
            mockExistsSync.mockReturnValue(false);

            expect(() => loadTypeDefinitions("/nonexistent/types.yml")).toThrow(
                "Type definitions file not found: /nonexistent/types.yml"
            );
        });

        // Scenario: Invalid YAML structure - missing types array
        it("should throw error when types array is missing", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
categories:
  - id: spam
    description: Spam
`);

            expect(() => loadTypeDefinitions("/path/to/types.yml")).toThrow(
                "Invalid types file format: expected { types: [...] }"
            );
        });

        // Scenario: Invalid YAML structure - types is not an array
        it("should throw error when types is not an array", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
types:
  spam:
    description: Spam
`);

            expect(() => loadTypeDefinitions("/path/to/types.yml")).toThrow(
                "Invalid types file format: expected { types: [...] }"
            );
        });

        // Scenario: Type missing id
        it("should throw error when type is missing id", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
types:
  - description: Spam messages
`);

            expect(() => loadTypeDefinitions("/path/to/types.yml")).toThrow(
                "Invalid type at index 0: missing or invalid 'id'"
            );
        });

        // Scenario: Type with non-string id
        it("should throw error when type id is not a string", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
types:
  - id: 123
    description: Numeric ID
`);

            expect(() => loadTypeDefinitions("/path/to/types.yml")).toThrow(
                "Invalid type at index 0: missing or invalid 'id'"
            );
        });

        // Scenario: Type missing description
        it("should throw error when type is missing description", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
types:
  - id: spam
`);

            expect(() => loadTypeDefinitions("/path/to/types.yml")).toThrow(
                "Invalid type at index 0: missing or invalid 'description'"
            );
        });

        // Scenario: Type with non-string description
        it("should throw error when type description is not a string", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
types:
  - id: spam
    description: 456
`);

            expect(() => loadTypeDefinitions("/path/to/types.yml")).toThrow(
                "Invalid type at index 0: missing or invalid 'description'"
            );
        });

        // Scenario: Second type is invalid
        it("should report correct index for invalid type", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
types:
  - id: spam
    description: Valid spam type
  - id: personal
`);

            expect(() => loadTypeDefinitions("/path/to/types.yml")).toThrow(
                "Invalid type at index 1: missing or invalid 'description'"
            );
        });

        // Scenario: Empty types array
        it("should return empty array for empty types list", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
types: []
`);

            const types = loadTypeDefinitions("/path/to/types.yml");

            expect(types).toEqual([]);
        });

        // Scenario: Examples is not an array (should be ignored)
        it("should ignore examples when not an array", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
types:
  - id: spam
    description: Spam messages
    examples: "Not an array"
`);

            const types = loadTypeDefinitions("/path/to/types.yml");

            expect(types[0]).toEqual({
                id         : "spam",
                description: "Spam messages",
            });
            expect(types[0]).not.toHaveProperty("examples");
        });
    });

    describe("loadTypeDefinitionsWithFallback", () => {
        // Scenario: Successfully load types from file
        it("should return types from file when valid", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
types:
  - id: custom_type
    description: Custom classification type
`);

            const types = loadTypeDefinitionsWithFallback("/path/to/types.yml");

            expect(types).toHaveLength(1);
            expect(types[0].id).toBe("custom_type");
        });

        // Scenario: Fall back to defaults when file not found
        it("should return default types when file not found", () => {
            mockExistsSync.mockReturnValue(false);

            // Spy on console.warn
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            const types = loadTypeDefinitionsWithFallback("/nonexistent/types.yml");

            expect(types).toEqual(getDefaultTypes());
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining("Failed to load types"),
                expect.any(Error)
            );

            warnSpy.mockRestore();
        });

        // Scenario: Fall back to defaults when YAML is invalid
        it("should return default types when YAML is invalid", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue("invalid: yaml: content: :");

            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            const types = loadTypeDefinitionsWithFallback("/path/to/types.yml");

            expect(types).toEqual(getDefaultTypes());

            warnSpy.mockRestore();
        });
    });

    describe("getDefaultTypes", () => {
        // Scenario: Returns standard default types
        it("should return array of default type definitions", () => {
            const defaults = getDefaultTypes();

            expect(Array.isArray(defaults)).toBe(true);
            expect(defaults.length).toBeGreaterThan(0);
        });

        // Scenario: Default types include essential categories
        it("should include essential categories", () => {
            const defaults = getDefaultTypes();
            const ids = defaults.map((t) => t.id);

            expect(ids).toContain("spam");
            expect(ids).toContain("personal");
            expect(ids).toContain("promotional");
            expect(ids).toContain("transactional");
            expect(ids).toContain("verification");
            expect(ids).toContain("unknown");
        });

        // Scenario: All default types have required fields
        it("should have id and description for all default types", () => {
            const defaults = getDefaultTypes();

            for (const typeDef of defaults) {
                expect(typeof typeDef.id).toBe("string");
                expect(typeDef.id.length).toBeGreaterThan(0);
                expect(typeof typeDef.description).toBe("string");
                expect(typeDef.description.length).toBeGreaterThan(0);
            }
        });

        // Scenario: Returns new array each time (immutability)
        it("should return new array instance each time", () => {
            const defaults1 = getDefaultTypes();
            const defaults2 = getDefaultTypes();

            expect(defaults1).not.toBe(defaults2);
            expect(defaults1).toEqual(defaults2);
        });
    });

    describe("realistic scenarios", () => {
        // Scenario: Load production types configuration
        it("should handle comprehensive production types file", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
types:
  - id: spam
    description: Unsolicited spam, scam, or phishing messages
    examples:
      - "You won $1,000,000!"
      - "URGENT: Click here now"
  - id: scam
    description: Fraudulent messages attempting to steal information
    examples:
      - "Your bank account has been compromised"
      - "IRS requires immediate payment"
  - id: personal
    description: Messages from friends, family, or known contacts
  - id: promotional
    description: Marketing messages from legitimate businesses
    examples:
      - "50% off sale today!"
      - "Your order has shipped"
  - id: transactional
    description: Bank alerts, delivery notifications, appointment reminders
  - id: verification
    description: 2FA codes, login verification, password resets
    examples:
      - "Your verification code is 123456"
  - id: political_spam
    description: Unsolicited political campaign messages
  - id: unknown
    description: Messages that cannot be confidently classified
`);

            const types = loadTypeDefinitions("/config/types.yml");

            expect(types).toHaveLength(8);

            const spamType = types.find((t) => t.id === "spam");
            expect(spamType?.examples).toHaveLength(2);

            const personalType = types.find((t) => t.id === "personal");
            expect(personalType?.examples).toBeUndefined();
        });

        // Scenario: Types file with special characters in descriptions
        it("should handle special characters in descriptions", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
types:
  - id: promotional
    description: "Marketing messages with offers (e.g., 50% off!)"
  - id: transactional
    description: Bank alerts & delivery notifications
`);

            const types = loadTypeDefinitions("/path/to/types.yml");

            expect(types[0].description).toBe(
                "Marketing messages with offers (e.g., 50% off!)"
            );
            expect(types[1].description).toBe(
                "Bank alerts & delivery notifications"
            );
        });
    });
});
