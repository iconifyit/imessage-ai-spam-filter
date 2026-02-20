/**
 * @fileoverview Unit tests for DeleteActionPlugin
 *
 * Tests cover:
 * - Plugin configuration and bindings
 * - Handle method behavior with mocked AppleScript
 * - Dry run mode
 * - Error handling
 * - Edge cases (missing sender)
 *
 * @module domain/__tests__/DeleteAction
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DeleteActionPlugin } from "../domain/actions/DeleteAction.js";
import type { ActionContext, ClassificationOutput } from "@tagrouter/engine";
import { createSMSMessage } from "../domain/entities/SMSMessage.js";

// Mock the AppleScript module
vi.mock("../../adapters/imessage/services/applescript.js", () => ({
    deleteConversationBySender: vi.fn(),
}));

import { deleteConversationBySender } from "../adapters/imessage/services/applescript.js";

const mockDeleteConversation = vi.mocked(deleteConversationBySender);

/**
 * Fixed test timestamp for consistent test results.
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
    sender?: string | null;
} = {}) {
    return createSMSMessage({
        id      : overrides.id ?? "msg-spam-001",
        content : overrides.content ?? "URGENT: You won $1,000,000! Click here!",
        metadata: {
            sender   : overrides.sender ?? "+18005551234",
            timestamp: TEST_TIME,
            isFromMe : false,
            isRead   : false,
            service  : "SMS",
            chatId   : null,
            guid     : "spam-guid-001",
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
    };
}

describe("DeleteActionPlugin", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("constructor", () => {
        // Scenario: Create plugin with default configuration
        it("should create plugin with default bindings", () => {
            const plugin = new DeleteActionPlugin();

            expect(plugin.id).toBe("delete-spam");
            expect(plugin.name).toBe("Delete Spam Messages");
            expect(plugin.bindings).toHaveProperty("spam");
            expect(plugin.bindings).toHaveProperty("scam");
            expect(plugin.bindings.spam.minConfidence).toBe(0.9);
        });

        // Scenario: Create plugin with custom bindings
        it("should accept custom bindings", () => {
            const customBindings = {
                spam          : { minConfidence: 0.85 },
                political_spam: { minConfidence: 0.8 },
            };

            const plugin = new DeleteActionPlugin({ bindings: customBindings });

            expect(plugin.bindings).toEqual(customBindings);
        });

        // Scenario: Create plugin with dry run mode
        it("should accept dryRun configuration", () => {
            const plugin = new DeleteActionPlugin({ dryRun: true });

            // dryRun is private, but we can test via behavior
            expect(plugin).toBeDefined();
        });
    });

    describe("handle - success cases", () => {
        // Scenario: Successfully delete spam conversation
        it("should delete conversation and return success", async () => {
            mockDeleteConversation.mockResolvedValue({
                success: true,
                output : "Conversation deleted",
            });

            const plugin = new DeleteActionPlugin();
            const message = createTestMessage({
                sender: "+18005559999",
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            expect(result.success).toBe(true);
            expect(result.actionId).toBe("delete-spam");
            expect(result.data).toEqual({
                sender: "+18005559999",
                output: "Conversation deleted",
            });
            expect(mockDeleteConversation).toHaveBeenCalledWith("+18005559999");
        });

        // Scenario: Log deletion via logger
        it("should log deletion info via logger", async () => {
            mockDeleteConversation.mockResolvedValue({
                success: true,
                output : "Deleted",
            });

            const plugin = new DeleteActionPlugin();
            const message = createTestMessage();
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.92,
            };
            const context = createTestContext(message, classification);
            const mockLogger = context.logger as ReturnType<typeof createMockLogger>;

            await plugin.handle(context);

            expect(mockLogger.info).toHaveBeenCalledWith(
                "Deleting spam conversation",
                expect.objectContaining({
                    messageId : message.id,
                    sender    : "+18005551234",
                    type      : "spam",
                    confidence: 0.92,
                })
            );

            expect(mockLogger.info).toHaveBeenCalledWith(
                "Successfully deleted conversation",
                expect.objectContaining({
                    sender: "+18005551234",
                })
            );
        });
    });

    describe("handle - dry run mode", () => {
        // Scenario: Dry run does not actually delete
        it("should not call deleteConversation in dry run mode", async () => {
            const plugin = new DeleteActionPlugin({ dryRun: true });
            const message = createTestMessage();
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            expect(result.success).toBe(true);
            expect(result.data).toEqual({
                dryRun     : true,
                sender     : "+18005551234",
                wouldDelete: true,
            });
            expect(mockDeleteConversation).not.toHaveBeenCalled();
        });

        // Scenario: Dry run logs appropriately
        it("should log dry run message", async () => {
            const plugin = new DeleteActionPlugin({ dryRun: true });
            const message = createTestMessage();
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);
            const mockLogger = context.logger as ReturnType<typeof createMockLogger>;

            await plugin.handle(context);

            expect(mockLogger.info).toHaveBeenCalledWith(
                "Deleting spam conversation",
                expect.objectContaining({ dryRun: true })
            );
            expect(mockLogger.info).toHaveBeenCalledWith(
                "DRY RUN: Would delete conversation",
                expect.objectContaining({ sender: "+18005551234" })
            );
        });

        // Scenario: setDryRun method works
        it("should toggle dry run mode via setDryRun", async () => {
            const plugin = new DeleteActionPlugin({ dryRun: false });
            plugin.setDryRun(true);

            const message = createTestMessage();
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            expect(result.data).toHaveProperty("dryRun", true);
            expect(mockDeleteConversation).not.toHaveBeenCalled();
        });
    });

    describe("handle - error cases", () => {
        // Scenario: Missing sender in metadata
        it("should return error when sender is missing", async () => {
            const plugin = new DeleteActionPlugin();
            const message = createSMSMessage({
                id      : "msg-no-sender",
                content : "Some content",
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
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);
            const mockLogger = context.logger as ReturnType<typeof createMockLogger>;

            const result = await plugin.handle(context);

            expect(result.success).toBe(false);
            expect(result.error).toBe("No sender in message metadata");
            expect(mockDeleteConversation).not.toHaveBeenCalled();
            expect(mockLogger.warn).toHaveBeenCalledWith(
                "Cannot delete: no sender in message metadata",
                expect.any(Object)
            );
        });

        // Scenario: AppleScript returns failure
        it("should return error when AppleScript fails", async () => {
            mockDeleteConversation.mockResolvedValue({
                success: false,
                error  : "Messages app not responding",
            });

            const plugin = new DeleteActionPlugin();
            const message = createTestMessage();
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);
            const mockLogger = context.logger as ReturnType<typeof createMockLogger>;

            const result = await plugin.handle(context);

            expect(result.success).toBe(false);
            expect(result.error).toBe("Messages app not responding");
            expect(mockLogger.error).toHaveBeenCalledWith(
                "Failed to delete conversation",
                expect.objectContaining({
                    error: "Messages app not responding",
                })
            );
        });

        // Scenario: AppleScript throws exception
        it("should catch and return error when AppleScript throws", async () => {
            mockDeleteConversation.mockRejectedValue(
                new Error("AppleScript execution failed")
            );

            const plugin = new DeleteActionPlugin();
            const message = createTestMessage();
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);
            const mockLogger = context.logger as ReturnType<typeof createMockLogger>;

            const result = await plugin.handle(context);

            expect(result.success).toBe(false);
            expect(result.error).toBe("AppleScript execution failed");
            expect(mockLogger.error).toHaveBeenCalledWith(
                "Delete action threw error",
                expect.objectContaining({
                    error: "AppleScript execution failed",
                })
            );
        });

        // Scenario: AppleScript throws non-Error
        it("should handle non-Error throws", async () => {
            mockDeleteConversation.mockRejectedValue("String error");

            const plugin = new DeleteActionPlugin();
            const message = createTestMessage();
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            expect(result.success).toBe(false);
            expect(result.error).toBe("String error");
        });

        // Scenario: AppleScript returns failure with no error message
        it("should use default error message when none provided", async () => {
            mockDeleteConversation.mockResolvedValue({
                success: false,
            });

            const plugin = new DeleteActionPlugin();
            const message = createTestMessage();
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            expect(result.success).toBe(false);
            expect(result.error).toBe("Unknown AppleScript error");
        });
    });

    describe("realistic scenarios", () => {
        // Scenario: Delete high-confidence scam message
        it("should delete confirmed scam message", async () => {
            mockDeleteConversation.mockResolvedValue({
                success: true,
                output : "Conversation with +1800SCAMMER deleted",
            });

            const plugin = new DeleteActionPlugin();
            const message = createTestMessage({
                content: "Your SSN has been compromised. Call us immediately!",
                sender : "+1800SCAMMER",
            });
            const classification: ClassificationOutput = {
                type      : "scam",
                confidence: 0.99,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            expect(result.success).toBe(true);
            expect(mockDeleteConversation).toHaveBeenCalledWith("+1800SCAMMER");
        });

        // Scenario: Multiple deletions in sequence
        it("should handle sequential deletions", async () => {
            mockDeleteConversation.mockResolvedValue({
                success: true,
                output : "Deleted",
            });

            const plugin = new DeleteActionPlugin();

            const spammers = [
                "+18001111111",
                "+18002222222",
                "+18003333333",
            ];

            for (const sender of spammers) {
                const message = createTestMessage({ sender });
                const classification: ClassificationOutput = {
                    type      : "spam",
                    confidence: 0.95,
                };
                const context = createTestContext(message, classification);

                const result = await plugin.handle(context);
                expect(result.success).toBe(true);
            }

            expect(mockDeleteConversation).toHaveBeenCalledTimes(3);
            expect(mockDeleteConversation).toHaveBeenNthCalledWith(1, "+18001111111");
            expect(mockDeleteConversation).toHaveBeenNthCalledWith(2, "+18002222222");
            expect(mockDeleteConversation).toHaveBeenNthCalledWith(3, "+18003333333");
        });
    });
});
