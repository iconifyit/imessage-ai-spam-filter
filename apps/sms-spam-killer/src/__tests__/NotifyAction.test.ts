/**
 * @fileoverview Unit tests for NotifyActionPlugin
 *
 * Tests cover:
 * - Plugin configuration and bindings
 * - Notification formatting (title, subtitle, message)
 * - Handle method behavior with various inputs
 * - Edge cases (missing sender, long content truncation)
 *
 * @module domain/__tests__/NotifyAction
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NotifyActionPlugin } from "../domain/actions/NotifyAction.js";
import type { ActionContext, ClassificationOutput } from "@tagrouter/engine";
import { createSMSMessage } from "../domain/entities/SMSMessage.js";

/**
 * Fixed test timestamp for consistent test results.
 * All dates derived relative to this time.
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
 * Create a realistic SMS message for testing.
 *
 * @param overrides - Partial message properties to override
 * @returns SMSMessage entity
 */
function createTestMessage(overrides: {
    id?: string;
    content?: string;
    sender?: string;
    isFromMe?: boolean;
} = {}) {
    return createSMSMessage({
        id      : overrides.id ?? "msg-test-001",
        content : overrides.content ?? "This is a spam message. Click here to win!",
        metadata: {
            sender   : overrides.sender ?? "+18005551234",
            timestamp: TEST_TIME,
            isFromMe : overrides.isFromMe ?? false,
            isRead   : false,
            service  : "SMS",
            chatId   : null,
            guid     : "test-guid-001",
        },
    });
}

/**
 * Create an action context for testing.
 *
 * @param message - The message entity
 * @param classification - The classification output
 * @returns ActionContext
 */
function createTestContext(
    message: ReturnType<typeof createTestMessage>,
    classification: ClassificationOutput
): ActionContext {
    return {
        message,
        classification,
        config: {},
        logger: createMockLogger(),
        traceId: "test-trace-id",
    };
}

describe("NotifyActionPlugin", () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleSpy.mockRestore();
    });

    describe("constructor", () => {
        // Scenario: Create plugin with default configuration
        it("should create plugin with default bindings", () => {
            const plugin = new NotifyActionPlugin();

            expect(plugin.id).toBe("notify-spam");
            expect(plugin.name).toBe("Notify Spam Detection");
            expect(plugin.bindings).toHaveProperty("spam");
            expect(plugin.bindings).toHaveProperty("promotional");
            expect(plugin.bindings).toHaveProperty("suspicious");
        });

        // Scenario: Create plugin with custom bindings
        it("should accept custom bindings", () => {
            const customBindings = {
                spam: { minConfidence: 0.8 },
                scam: { minConfidence: 0.75 },
            };

            const plugin = new NotifyActionPlugin({ bindings: customBindings });

            expect(plugin.bindings).toEqual(customBindings);
        });

        // Scenario: Create plugin with custom title template
        it("should accept custom title template", async () => {
            const plugin = new NotifyActionPlugin({
                titleTemplate: "Alert: {{type}} Message",
            });

            const message = createTestMessage();
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.9,
            };
            const context = createTestContext(message, classification);

            await plugin.handle(context);

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("Alert: Spam Message")
            );
        });
    });

    describe("handle", () => {
        // Scenario: Successfully log notification for spam message
        it("should log notification to console for spam message", async () => {
            const plugin = new NotifyActionPlugin();
            const message = createTestMessage({
                content: "URGENT: You won $1000! Claim now!",
                sender : "+18005559999",
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            // Should return success
            expect(result.success).toBe(true);
            expect(result.actionId).toBe("notify-spam");

            // Should log to console
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("🚨 Spam Detected")
            );
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("Confidence: 95%")
            );
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("+18005559999")
            );
        });

        // Scenario: Format confidence as percentage
        it("should format confidence as percentage", async () => {
            const plugin = new NotifyActionPlugin();
            const message = createTestMessage();
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.873,
            };
            const context = createTestContext(message, classification);

            await plugin.handle(context);

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("Confidence: 87%")
            );
        });

        // Scenario: Default confidence to 100% when not specified
        it("should default confidence to 100% when not specified", async () => {
            const plugin = new NotifyActionPlugin();
            const message = createTestMessage();
            const classification: ClassificationOutput = {
                type: "spam",
            };
            const context = createTestContext(message, classification);

            await plugin.handle(context);

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("Confidence: 100%")
            );
        });

        // Scenario: Truncate long message content
        it("should truncate message content exceeding 100 characters", async () => {
            const plugin = new NotifyActionPlugin();
            const longContent = "A".repeat(150);
            const message = createTestMessage({ content: longContent });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.9,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            // Result data should contain truncated message
            expect(result.data).toBeDefined();
            const messageData = result.data as { message: string };
            expect(messageData.message.length).toBeLessThanOrEqual(120); // sender line + truncated content
            expect(messageData.message).toContain("...");
        });

        // Scenario: Handle message without sender gracefully
        it("should use 'Unknown' when sender is missing", async () => {
            const plugin = new NotifyActionPlugin();
            const message = createSMSMessage({
                id      : "msg-no-sender",
                content : "Test message",
                metadata: {
                    sender   : undefined as unknown as string,
                    timestamp: TEST_TIME,
                    isFromMe : false,
                    isRead   : false,
                    service  : "SMS",
                    chatId   : null,
                    guid     : "test-guid",
                },
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.9,
            };
            const context = createTestContext(message, classification);

            await plugin.handle(context);

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("Unknown")
            );
        });

        // Scenario: Format different classification types correctly
        it("should capitalize classification type in title", async () => {
            const plugin = new NotifyActionPlugin();
            const message = createTestMessage();

            // Test with promotional type
            const classification: ClassificationOutput = {
                type      : "promotional",
                confidence: 0.85,
            };
            const context = createTestContext(message, classification);

            await plugin.handle(context);

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("Promotional Detected")
            );
        });

        // Scenario: Return correct data in result
        it("should return notification data in result", async () => {
            const plugin = new NotifyActionPlugin();
            const message = createTestMessage({
                content: "Short message",
                sender : "+15551234567",
            });
            const classification: ClassificationOutput = {
                type      : "scam",
                confidence: 0.92,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            expect(result.data).toEqual({
                title   : "Scam Detected",
                message : "From: +15551234567\nShort message",
                subtitle: "Confidence: 92%",
            });
        });

        // Scenario: Log via logger
        it("should log notification via logger.info", async () => {
            const plugin = new NotifyActionPlugin();
            const message = createTestMessage();
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.9,
            };
            const context = createTestContext(message, classification);
            const mockLogger = context.logger as ReturnType<typeof createMockLogger>;

            await plugin.handle(context);

            expect(mockLogger.info).toHaveBeenCalledWith(
                "Spam notification logged",
                expect.objectContaining({
                    messageId: message.id,
                    type     : "spam",
                })
            );
        });
    });

    describe("realistic scenarios", () => {
        // Scenario: Phishing attempt notification
        it("should notify for phishing attempt", async () => {
            const plugin = new NotifyActionPlugin();
            const message = createTestMessage({
                content: "Your bank account has been compromised! Click here immediately: http://fake-bank.com/login",
                sender : "+1800SCAMMER",
            });
            const classification: ClassificationOutput = {
                type      : "scam",
                confidence: 0.98,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            expect(result.success).toBe(true);
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("Scam Detected")
            );
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("98%")
            );
        });

        // Scenario: Political spam notification
        it("should notify for political spam", async () => {
            const plugin = new NotifyActionPlugin();
            const message = createTestMessage({
                content: "Vote YES on Prop 123! Your future depends on it!",
                sender : "CAMPAIGN",
            });
            const classification: ClassificationOutput = {
                type      : "political_spam",
                confidence: 0.87,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            expect(result.success).toBe(true);
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("Political_spam Detected")
            );
        });
    });
});
