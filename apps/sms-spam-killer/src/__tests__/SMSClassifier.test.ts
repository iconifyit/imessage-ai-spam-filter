/**
 * @fileoverview Unit tests for SMSClassificationPlugin
 *
 * Tests cover:
 * - Plugin initialization and configuration
 * - Classification behavior with mocked OpenAI
 * - Error handling
 * - Type definitions management
 *
 * @module domain/__tests__/SMSClassifier
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    SMSClassificationPlugin,
    type TypeDefinition,
} from "../domain/classifiers/SMSClassifier.js";
import type { ClassificationContext, Entity } from "@tagrouter/engine";
import { createSMSMessage } from "../domain/entities/SMSMessage.js";

// Mock the OpenAI classifier module
vi.mock("../classifiers/openai-classifier.js", () => ({
    OpenAIClassifier: vi.fn().mockImplementation(() => ({
        setSystemPrompt: vi.fn(),
        configure      : vi.fn().mockResolvedValue(undefined),
        classify       : vi.fn(),
    })),
}));

import { OpenAIClassifier } from "../classifiers/openai-classifier.js";

const MockedOpenAIClassifier = vi.mocked(OpenAIClassifier);

/**
 * Fixed test timestamp.
 */
const TEST_TIME = new Date("2025-02-15T10:00:00.000Z");

/**
 * Create a mock logger for testing.
 */
function createMockLogger() {
    return {
        debug: vi.fn(),
        info : vi.fn(),
        warn : vi.fn(),
        error: vi.fn(),
    };
}

/**
 * Create a classification context for testing.
 */
function createTestContext(): ClassificationContext {
    return {
        config : {},
        logger : createMockLogger(),
        traceId: "test-trace-001",
    };
}

/**
 * Create realistic test type definitions.
 */
function createTestTypes(): TypeDefinition[] {
    return [
        {
            id         : "spam",
            description: "Spam, scam, or phishing messages",
            examples   : ["You won $1,000,000!", "URGENT: Click here now"],
        },
        {
            id         : "personal",
            description: "Personal messages from contacts",
        },
        {
            id         : "promotional",
            description: "Marketing messages from businesses",
        },
        {
            id         : "unknown",
            description: "Cannot be classified",
        },
    ];
}

/**
 * Create a test SMS message.
 */
function createTestMessage(overrides: {
    id?: string;
    content?: string;
    sender?: string;
} = {}) {
    return createSMSMessage({
        id      : overrides.id ?? "msg-test-001",
        content : overrides.content ?? "Test message content",
        metadata: {
            sender   : overrides.sender ?? "+15551234567",
            timestamp: TEST_TIME,
            isFromMe : false,
            isRead   : false,
            service  : "SMS",
            chatId   : null,
            guid     : "test-guid-001",
        },
    });
}

describe("SMSClassificationPlugin", () => {
    let mockClassifyFn: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();

        // Set up mock classify function
        mockClassifyFn = vi.fn();

        MockedOpenAIClassifier.mockImplementation(() => ({
            setSystemPrompt: vi.fn(),
            configure      : vi.fn().mockResolvedValue(undefined),
            classify       : mockClassifyFn,
        }) as unknown as InstanceType<typeof OpenAIClassifier>);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("constructor", () => {
        // Scenario: Create plugin with required configuration
        it("should create plugin with types and custom id", () => {
            const types = createTestTypes();
            const plugin = new SMSClassificationPlugin(
                { types, systemPrompt: "Test prompt" },
                "my-classifier"
            );

            expect(plugin.id).toBe("my-classifier");
            expect(plugin.name).toBe("SMS Classification Plugin");
            expect(plugin.description).toContain("AI-powered");
        });

        // Scenario: Create plugin with default id
        it("should use default id when not specified", () => {
            const types = createTestTypes();
            const plugin = new SMSClassificationPlugin({ types, systemPrompt: "Test prompt" });

            expect(plugin.id).toBe("sms-classifier");
        });

        // Scenario: Plugin starts uninitialized
        it("should start in uninitialized state", () => {
            const types = createTestTypes();
            const plugin = new SMSClassificationPlugin({ types, systemPrompt: "Test prompt" });

            expect(plugin.isInitialized).toBe(false);
        });

        // Scenario: Types are accessible
        it("should expose configured types", () => {
            const types = createTestTypes();
            const plugin = new SMSClassificationPlugin({ types, systemPrompt: "Test prompt" });

            expect(plugin.types).toEqual(types);
        });
    });

    describe("initialize", () => {
        // Scenario: Successfully initialize plugin
        it("should initialize with configured types", async () => {
            const types = createTestTypes();
            const plugin = new SMSClassificationPlugin({ types, systemPrompt: "Test prompt" });

            await plugin.initialize();

            expect(plugin.isInitialized).toBe(true);
        });

        // Scenario: Initialize is idempotent
        it("should not reinitialize if already initialized", async () => {
            const types = createTestTypes();
            const plugin = new SMSClassificationPlugin({ types, systemPrompt: "Test prompt" });

            await plugin.initialize();
            await plugin.initialize();

            // OpenAI configure should only be called once
            const instance = MockedOpenAIClassifier.mock.results[0]?.value;
            expect(instance?.configure).toHaveBeenCalledTimes(1);
        });

        // Scenario: Fail initialization with no types
        it("should throw error when no types configured", async () => {
            const plugin = new SMSClassificationPlugin({
                types       : [],
                systemPrompt: "Test prompt",
            });

            await expect(plugin.initialize()).rejects.toThrow(
                "No type definitions provided"
            );
        });
    });

    describe("classify", () => {
        // Scenario: Classify message successfully
        it("should classify message and return output", async () => {
            mockClassifyFn.mockResolvedValue({
                type       : "spam",
                confidence : 0.95,
                explanation: "Contains spam keywords",
            });

            const types = createTestTypes();
            const plugin = new SMSClassificationPlugin({ types, systemPrompt: "Test prompt" });
            await plugin.initialize();

            const message = createTestMessage({
                content: "URGENT: You won $1,000,000! Click here!",
            });
            const context = createTestContext();

            const result = await plugin.classify(message, context);

            expect(result).not.toBeNull();
            expect(result?.type).toBe("spam");
            expect(result?.confidence).toBe(0.95);
            expect(result?.tags).toContain("Contains spam keywords");
        });

        // Scenario: Classification without explanation
        it("should handle classification without explanation", async () => {
            mockClassifyFn.mockResolvedValue({
                type      : "personal",
                confidence: 0.88,
            });

            const types = createTestTypes();
            const plugin = new SMSClassificationPlugin({ types, systemPrompt: "Test prompt" });
            await plugin.initialize();

            const message = createTestMessage({
                content: "Hey, are you free for lunch?",
            });
            const context = createTestContext();

            const result = await plugin.classify(message, context);

            expect(result?.type).toBe("personal");
            expect(result?.tags).toBeUndefined();
        });

        // Scenario: Throw error if not initialized
        it("should throw error when classify called before initialize", async () => {
            const types = createTestTypes();
            const plugin = new SMSClassificationPlugin({ types, systemPrompt: "Test prompt" });

            const message = createTestMessage();
            const context = createTestContext();

            await expect(plugin.classify(message, context)).rejects.toThrow(
                "Plugin not initialized"
            );
        });

        // Scenario: Handle classification error gracefully
        it("should return unknown classification on error", async () => {
            mockClassifyFn.mockRejectedValue(new Error("OpenAI API rate limited"));

            const types = createTestTypes();
            const plugin = new SMSClassificationPlugin({ types, systemPrompt: "Test prompt" });
            await plugin.initialize();

            const message = createTestMessage();
            const context = createTestContext();
            const mockLogger = context.logger as ReturnType<typeof createMockLogger>;

            const result = await plugin.classify(message, context);

            expect(result?.type).toBe("unknown");
            expect(result?.confidence).toBe(0);
            expect(result?.tags?.[0]).toContain("error: OpenAI API rate limited");
            expect(mockLogger.error).toHaveBeenCalled();
        });

        // Scenario: Handle non-Error thrown
        it("should handle non-Error thrown during classification", async () => {
            mockClassifyFn.mockRejectedValue("String error");

            const types = createTestTypes();
            const plugin = new SMSClassificationPlugin({ types, systemPrompt: "Test prompt" });
            await plugin.initialize();

            const message = createTestMessage();
            const context = createTestContext();

            const result = await plugin.classify(message, context);

            expect(result?.type).toBe("unknown");
            expect(result?.tags?.[0]).toContain("error: String error");
        });

        // Scenario: Log classification via logger
        it("should log classification via logger", async () => {
            mockClassifyFn.mockResolvedValue({
                type      : "promotional",
                confidence: 0.78,
            });

            const types = createTestTypes();
            const plugin = new SMSClassificationPlugin({ types, systemPrompt: "Test prompt" });
            await plugin.initialize();

            const message = createTestMessage({ sender: "+18005551234" });
            const context = createTestContext();
            const mockLogger = context.logger as ReturnType<typeof createMockLogger>;

            await plugin.classify(message, context);

            expect(mockLogger.debug).toHaveBeenCalledWith(
                "Classifying SMS message",
                expect.objectContaining({
                    messageId: message.id,
                    sender   : "+18005551234",
                })
            );

            expect(mockLogger.info).toHaveBeenCalledWith(
                "Classification complete",
                expect.objectContaining({
                    type      : "promotional",
                    confidence: 0.78,
                })
            );
        });
    });

    describe("setTypes", () => {
        // Scenario: Update types requires re-initialization
        it("should reset initialized state when types updated", async () => {
            const types = createTestTypes();
            const plugin = new SMSClassificationPlugin({ types, systemPrompt: "Test prompt" });
            await plugin.initialize();

            expect(plugin.isInitialized).toBe(true);

            plugin.setTypes([{ id: "new", description: "New type" }]);

            expect(plugin.isInitialized).toBe(false);
            expect(plugin.types).toEqual([{ id: "new", description: "New type" }]);
        });
    });

    describe("setSystemPrompt", () => {
        // Scenario: Update system prompt requires re-initialization
        it("should reset initialized state when prompt updated", async () => {
            const types = createTestTypes();
            const plugin = new SMSClassificationPlugin({ types, systemPrompt: "Test prompt" });
            await plugin.initialize();

            expect(plugin.isInitialized).toBe(true);

            plugin.setSystemPrompt("New custom prompt with {{categories}}");

            expect(plugin.isInitialized).toBe(false);
        });
    });

    describe("realistic scenarios", () => {
        // Scenario: Classify phishing message
        it("should classify phishing attempt as scam with high confidence", async () => {
            mockClassifyFn.mockResolvedValue({
                type       : "spam",
                confidence : 0.98,
                explanation: "Message contains phishing indicators: urgent language, suspicious link",
            });

            const types = createTestTypes();
            const plugin = new SMSClassificationPlugin({ types, systemPrompt: "Test prompt" });
            await plugin.initialize();

            const message = createTestMessage({
                content: "URGENT: Your bank account has been compromised! Click here immediately: http://fake-bank.com/verify",
                sender : "+1800SCAMMER",
            });
            const context = createTestContext();

            const result = await plugin.classify(message, context);

            expect(result?.type).toBe("spam");
            expect(result?.confidence).toBeGreaterThan(0.9);
        });

        // Scenario: Classify 2FA code
        it("should classify 2FA code as verification", async () => {
            // Add verification type
            const types = [
                ...createTestTypes(),
                { id: "verification", description: "2FA and verification codes" },
            ];

            mockClassifyFn.mockResolvedValue({
                type       : "verification",
                confidence : 0.99,
                explanation: "Contains 6-digit verification code",
            });

            const plugin = new SMSClassificationPlugin({ types, systemPrompt: "Test prompt" });
            await plugin.initialize();

            const message = createTestMessage({
                content: "Your verification code is 847293. Do not share this code with anyone.",
                sender : "12345",
            });
            const context = createTestContext();

            const result = await plugin.classify(message, context);

            expect(result?.type).toBe("verification");
            expect(result?.confidence).toBe(0.99);
        });

        // Scenario: Handle ambiguous message
        it("should return low confidence for ambiguous messages", async () => {
            mockClassifyFn.mockResolvedValue({
                type       : "unknown",
                confidence : 0.4,
                explanation: "Message is ambiguous, could be spam or legitimate",
            });

            const types = createTestTypes();
            const plugin = new SMSClassificationPlugin({ types, systemPrompt: "Test prompt" });
            await plugin.initialize();

            const message = createTestMessage({
                content: "Hey",
                sender : "+15559999999",
            });
            const context = createTestContext();

            const result = await plugin.classify(message, context);

            expect(result?.type).toBe("unknown");
            expect(result?.confidence).toBeLessThan(0.5);
        });
    });
});
