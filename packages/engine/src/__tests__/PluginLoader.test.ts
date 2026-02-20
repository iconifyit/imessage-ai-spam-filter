/**
 * @fileoverview Unit tests for PluginLoader
 *
 * Tests cover:
 * - createClassifierFromYaml factory
 * - YAML plugin loading
 * - Classification matching (regex, contains, sender)
 *
 * @module @tagrouter/engine/__tests__/PluginLoader
 */

import { describe, it, expect, vi } from "vitest";
import {
    createClassifierFromYaml,
    type YamlClassifierDefinition,
} from "../plugins/PluginLoader.js";
import type { ClassificationContext } from "../contracts/ClassificationPlugin.js";
import type { Entity } from "../contracts/Entity.js";

/**
 * Create a mock message for testing
 */
function createMockMessage(content: string, sender?: string): Entity<object> {
    return {
        id: "test-msg-1",
        content,
        metadata: sender ? { sender } : {},
    };
}

/**
 * Create a mock classification context
 */
function createMockContext(): ClassificationContext {
    return {
        config : {},
        traceId: "test-trace",
        logger : {
            debug: vi.fn(),
            info : vi.fn(),
            warn : vi.fn(),
            error: vi.fn(),
        },
    };
}

describe("createClassifierFromYaml", () => {
    describe("regex matching", () => {
        // Scenario: Regex pattern matches message content
        it("should match message content with regex", () => {
            const def: YamlClassifierDefinition = {
                name : "political-spam",
                match: {
                    regex: "(donate|contribute|campaign)",
                },
                type: "political_spam",
            };

            const classifier = createClassifierFromYaml(def);
            const message = createMockMessage("Please donate to our campaign!");
            const result = classifier.classify(message, createMockContext());

            expect(result).not.toBeNull();
            expect(result?.type).toBe("political_spam");
        });

        // Scenario: Regex pattern is case-insensitive
        it("should match case-insensitively", () => {
            const def: YamlClassifierDefinition = {
                name : "urgent-scam",
                match: {
                    regex: "URGENT",
                },
                type: "scam",
            };

            const classifier = createClassifierFromYaml(def);
            const message = createMockMessage("urgent: You have won!");
            const result = classifier.classify(message, createMockContext());

            expect(result).not.toBeNull();
            expect(result?.type).toBe("scam");
        });

        // Scenario: Regex pattern does not match
        it("should return null when regex does not match", () => {
            const def: YamlClassifierDefinition = {
                name : "political-spam",
                match: {
                    regex: "(donate|contribute|campaign)",
                },
                type: "political_spam",
            };

            const classifier = createClassifierFromYaml(def);
            const message = createMockMessage("Hello, how are you?");
            const result = classifier.classify(message, createMockContext());

            expect(result).toBeNull();
        });
    });

    describe("contains matching", () => {
        // Scenario: Contains string matches message content
        it("should match message content with contains", () => {
            const def: YamlClassifierDefinition = {
                name : "free-money",
                match: {
                    contains: "free money",
                },
                type: "spam",
            };

            const classifier = createClassifierFromYaml(def);
            const message = createMockMessage("Get FREE MONEY now!");
            const result = classifier.classify(message, createMockContext());

            expect(result).not.toBeNull();
            expect(result?.type).toBe("spam");
        });

        // Scenario: Contains is case-insensitive
        it("should match case-insensitively", () => {
            const def: YamlClassifierDefinition = {
                name : "bitcoin-spam",
                match: {
                    contains: "bitcoin",
                },
                type: "crypto_spam",
            };

            const classifier = createClassifierFromYaml(def);
            const message = createMockMessage("Invest in BITCOIN today!");
            const result = classifier.classify(message, createMockContext());

            expect(result).not.toBeNull();
            expect(result?.type).toBe("crypto_spam");
        });

        // Scenario: Contains string not found
        it("should return null when contains string not found", () => {
            const def: YamlClassifierDefinition = {
                name : "free-money",
                match: {
                    contains: "free money",
                },
                type: "spam",
            };

            const classifier = createClassifierFromYaml(def);
            const message = createMockMessage("Hello friend!");
            const result = classifier.classify(message, createMockContext());

            expect(result).toBeNull();
        });
    });

    describe("sender matching", () => {
        // Scenario: Sender pattern matches
        it("should match sender with regex", () => {
            const def: YamlClassifierDefinition = {
                name : "short-code",
                match: {
                    sender: "^\\d{5,6}$",
                },
                type: "marketing",
            };

            const classifier = createClassifierFromYaml(def);
            const message = createMockMessage("Sale today!", "12345");
            const result = classifier.classify(message, createMockContext());

            expect(result).not.toBeNull();
            expect(result?.type).toBe("marketing");
        });

        // Scenario: Sender pattern does not match
        it("should return null when sender does not match", () => {
            const def: YamlClassifierDefinition = {
                name : "short-code",
                match: {
                    sender: "^\\d{5,6}$",
                },
                type: "marketing",
            };

            const classifier = createClassifierFromYaml(def);
            const message = createMockMessage("Hello!", "+15551234567");
            const result = classifier.classify(message, createMockContext());

            expect(result).toBeNull();
        });
    });

    describe("confidence and tags", () => {
        // Scenario: Uses default confidence of 1.0
        it("should use default confidence of 1.0", () => {
            const def: YamlClassifierDefinition = {
                name : "test",
                match: { contains: "test" },
                type : "test_type",
            };

            const classifier = createClassifierFromYaml(def);
            const message = createMockMessage("This is a test");
            const result = classifier.classify(message, createMockContext());

            expect(result?.confidence).toBe(1.0);
        });

        // Scenario: Uses specified confidence
        it("should use specified confidence", () => {
            const def: YamlClassifierDefinition = {
                name      : "test",
                match     : { contains: "test" },
                type      : "test_type",
                confidence: 0.8,
            };

            const classifier = createClassifierFromYaml(def);
            const message = createMockMessage("This is a test");
            const result = classifier.classify(message, createMockContext());

            expect(result?.confidence).toBe(0.8);
        });

        // Scenario: Includes tags when specified
        it("should include tags when specified", () => {
            const def: YamlClassifierDefinition = {
                name : "test",
                match: { contains: "test" },
                type : "test_type",
                tags : ["tag1", "tag2"],
            };

            const classifier = createClassifierFromYaml(def);
            const message = createMockMessage("This is a test");
            const result = classifier.classify(message, createMockContext());

            expect(result?.tags).toEqual(["tag1", "tag2"]);
        });
    });

    describe("plugin metadata", () => {
        // Scenario: Plugin has correct id format
        it("should prefix id with yaml:", () => {
            const def: YamlClassifierDefinition = {
                name : "my-classifier",
                match: { contains: "test" },
                type : "test_type",
            };

            const classifier = createClassifierFromYaml(def);

            expect(classifier.id).toBe("yaml:my-classifier");
        });

        // Scenario: Plugin includes name and description
        it("should include name and description", () => {
            const def: YamlClassifierDefinition = {
                name       : "my-classifier",
                description: "A test classifier",
                match      : { contains: "test" },
                type       : "test_type",
            };

            const classifier = createClassifierFromYaml(def);

            expect(classifier.name).toBe("my-classifier");
            expect(classifier.description).toBe("A test classifier");
        });
    });

    describe("multiple match criteria", () => {
        // Scenario: Regex takes precedence when both match
        it("should match on regex first", () => {
            const def: YamlClassifierDefinition = {
                name : "multi-match",
                match: {
                    regex   : "urgent",
                    contains: "money",
                },
                type: "scam",
            };

            const classifier = createClassifierFromYaml(def);
            const message = createMockMessage("URGENT: Get money now!");
            const result = classifier.classify(message, createMockContext());

            expect(result).not.toBeNull();
            expect(result?.type).toBe("scam");
        });

        // Scenario: Falls back to contains if regex doesn't match
        it("should fall back to contains when regex does not match", () => {
            const def: YamlClassifierDefinition = {
                name : "multi-match",
                match: {
                    regex   : "xyz123abc",
                    contains: "money",
                },
                type: "scam",
            };

            const classifier = createClassifierFromYaml(def);
            const message = createMockMessage("Get money now!");
            const result = classifier.classify(message, createMockContext());

            expect(result).not.toBeNull();
            expect(result?.type).toBe("scam");
        });
    });
});
