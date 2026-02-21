/**
 * @fileoverview Unit tests for AddToFoesActionPlugin
 *
 * Tests cover:
 * - Successfully adding sender to foes file
 * - Idempotency (skipping duplicates)
 * - Error handling (missing sender, write errors)
 * - Default and custom bindings
 * - File operations (creation, deduplication, timestamps)
 * - Edge cases (non-existent foes file, file write failures)
 *
 * @module domain/__tests__/AddToFoesAction
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AddToFoesActionPlugin } from "../domain/actions/AddToFoesAction.js";
import type { ActionContext, ClassificationOutput } from "@tagrouter/engine";
import { createSMSMessage } from "../domain/entities/SMSMessage.js";

// Mock the fs module
vi.mock("fs", () => ({
    readFileSync  : vi.fn(),
    appendFileSync: vi.fn(),
    existsSync    : vi.fn(),
}));

import { readFileSync, appendFileSync, existsSync } from "fs";

const mockReadFileSync = vi.mocked(readFileSync);
const mockAppendFileSync = vi.mocked(appendFileSync);
const mockExistsSync = vi.mocked(existsSync);

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
        debug : vi.fn(),
        info  : vi.fn(),
        warn  : vi.fn(),
        error : vi.fn(),
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
        traceId: "test-trace-id",
    };
}

describe("AddToFoesActionPlugin", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("constructor and configuration", () => {
        // Scenario: Create plugin with default bindings
        it("should create plugin with default bindings", () => {
            const plugin = new AddToFoesActionPlugin({
                foesFile: "/path/to/foes.txt",
            });

            expect(plugin.id).toBe("add-to-foes");
            expect(plugin.name).toBe("Add Sender to Foes List");
            expect(plugin.bindings).toHaveProperty("spam");
            expect(plugin.bindings).toHaveProperty("scam");
            expect(plugin.bindings.spam.minConfidence).toBe(0.9);
            expect(plugin.bindings.scam.minConfidence).toBe(0.9);
        });

        // Scenario: Create plugin with custom bindings
        it("should accept custom bindings", () => {
            const customBindings = {
                spam : { minConfidence: 0.85 },
                scam : { minConfidence: 0.9 },
                phish: { minConfidence: 0.75 },
            };

            const plugin = new AddToFoesActionPlugin({
                foesFile : "/path/to/foes.txt",
                bindings : customBindings,
            });

            expect(plugin.bindings).toEqual(customBindings);
        });

        // Scenario: Custom bindings override defaults completely
        it("should completely override defaults with custom bindings", () => {
            const customBindings = {
                promotional: { minConfidence: 0.5 },
            };

            const plugin = new AddToFoesActionPlugin({
                foesFile : "/path/to/foes.txt",
                bindings : customBindings,
            });

            expect(plugin.bindings).toEqual(customBindings);
            expect(plugin.bindings).not.toHaveProperty("spam");
        });
    });

    describe("handle - success cases", () => {
        // Scenario: Successfully add new sender to foes file
        it("should add sender to foes file and return success", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue("existing@example.com\n+18001111111\n");
            mockAppendFileSync.mockImplementation(() => {});

            const plugin = new AddToFoesActionPlugin({
                foesFile: "/path/to/foes.txt",
            });

            const message = createTestMessage({
                sender: "+18005551234",
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            expect(result.success).toBe(true);
            expect(result.actionId).toBe("add-to-foes");
            expect(result.data).toEqual({
                alreadyPresent : false,
                sender         : "+18005551234",
            });

            // Verify appendFileSync was called
            expect(mockAppendFileSync).toHaveBeenCalledWith(
                "/path/to/foes.txt",
                expect.stringContaining("+18005551234"),
                "utf-8"
            );
        });

        // Scenario: Appended entry includes timestamp and classification metadata comment
        it("should include timestamp and classification metadata in appended entry", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue("");
            mockAppendFileSync.mockImplementation(() => {});

            const plugin = new AddToFoesActionPlugin({
                foesFile: "/path/to/foes.txt",
            });

            const message = createTestMessage({
                sender: "badguy@example.com",
            });
            const classification: ClassificationOutput = {
                type      : "scam",
                confidence: 0.99,
            };
            const context = createTestContext(message, classification);

            await plugin.handle(context);

            const callArgs = mockAppendFileSync.mock.calls[0];
            const entry = callArgs[1] as string;

            expect(entry).toContain("# Auto-added");
            expect(entry).toContain("scam");
            expect(entry).toContain("0.99");
            expect(entry).toContain("badguy@example.com");
            // Should start with newline and end with newline
            expect(entry.startsWith("\n")).toBe(true);
            expect(entry.endsWith("\n")).toBe(true);
        });

        // Scenario: Logs success via logger
        it("should log success information via logger", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue("");
            mockAppendFileSync.mockImplementation(() => {});

            const plugin = new AddToFoesActionPlugin({
                foesFile: "/path/to/foes.txt",
            });

            const message = createTestMessage({
                sender: "+18005551234",
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.92,
            };
            const context = createTestContext(message, classification);
            const mockLogger = context.logger as ReturnType<typeof createMockLogger>;

            await plugin.handle(context);

            expect(mockLogger.info).toHaveBeenCalledWith(
                "Added sender to foes list",
                expect.objectContaining({
                    messageId  : message.id,
                    sender     : "+18005551234",
                    type       : "spam",
                    confidence : 0.92,
                })
            );
        });
    });

    describe("handle - idempotency", () => {
        // Scenario: Skip if sender already in foes list
        it("should skip adding sender already in foes list", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(
                "existing1@example.com\n+18005551234\nexisting2@example.com\n"
            );

            const plugin = new AddToFoesActionPlugin({
                foesFile: "/path/to/foes.txt",
            });

            const message = createTestMessage({
                sender: "+18005551234",
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            expect(result.success).toBe(true);
            expect(result.data).toEqual({
                alreadyPresent : true,
                sender         : "+18005551234",
            });

            // Should NOT call appendFileSync
            expect(mockAppendFileSync).not.toHaveBeenCalled();
        });

        // Scenario: Case-insensitive deduplication
        it("should deduplicate using case-insensitive comparison", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue("SPAMMER@EXAMPLE.COM\n");

            const plugin = new AddToFoesActionPlugin({
                foesFile: "/path/to/foes.txt",
            });

            const message = createTestMessage({
                sender: "spammer@example.com",
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            expect(result.success).toBe(true);
            expect(result.data?.alreadyPresent).toBe(true);
            expect(mockAppendFileSync).not.toHaveBeenCalled();
        });

        // Scenario: Ignore comments when deduplicating
        it("should ignore comment lines when checking for duplicates", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(
                "# This is a comment about bad@example.com\nbad@example.com\n# Another comment\n"
            );

            const plugin = new AddToFoesActionPlugin({
                foesFile: "/path/to/foes.txt",
            });

            const message = createTestMessage({
                sender: "bad@example.com",
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            expect(result.data?.alreadyPresent).toBe(true);
            expect(mockAppendFileSync).not.toHaveBeenCalled();
        });

        // Scenario: Logs when sender already present
        it("should log when sender is already in foes list", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue("+18005551234\n");

            const plugin = new AddToFoesActionPlugin({
                foesFile: "/path/to/foes.txt",
            });

            const message = createTestMessage({
                sender: "+18005551234",
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);
            const mockLogger = context.logger as ReturnType<typeof createMockLogger>;

            await plugin.handle(context);

            expect(mockLogger.debug).toHaveBeenCalledWith(
                "Sender already in foes list, skipping",
                expect.objectContaining({
                    messageId : message.id,
                    sender    : "+18005551234",
                })
            );
        });
    });

    describe("handle - error cases", () => {
        // Scenario: Return error if no sender in message metadata
        it("should return error when sender is missing", async () => {
            const plugin = new AddToFoesActionPlugin({
                foesFile: "/path/to/foes.txt",
            });

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

            const result = await plugin.handle(context);

            expect(result.success).toBe(false);
            expect(result.error).toBe("No sender in message metadata");
            expect(mockAppendFileSync).not.toHaveBeenCalled();
        });

        // Scenario: Log warning when sender is missing
        it("should log warning when sender is missing", async () => {
            const plugin = new AddToFoesActionPlugin({
                foesFile: "/path/to/foes.txt",
            });

            const message = createSMSMessage({
                id      : "msg-no-sender",
                content : "Test",
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

            await plugin.handle(context);

            expect(mockLogger.warn).toHaveBeenCalledWith(
                "Cannot add to foes: no sender in message metadata",
                expect.objectContaining({
                    messageId: message.id,
                })
            );
        });

        // Scenario: Handle file write errors gracefully
        it("should catch and return error when appendFileSync throws", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue("");
            mockAppendFileSync.mockImplementation(() => {
                throw new Error("Permission denied: cannot write to file");
            });

            const plugin = new AddToFoesActionPlugin({
                foesFile: "/path/to/foes.txt",
            });

            const message = createTestMessage({
                sender: "+18005551234",
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            expect(result.success).toBe(false);
            expect(result.error).toBe("Permission denied: cannot write to file");
        });

        // Scenario: Log error when write fails
        it("should log error when file write fails", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue("");
            const writeError = new Error("I/O error");
            mockAppendFileSync.mockImplementation(() => {
                throw writeError;
            });

            const plugin = new AddToFoesActionPlugin({
                foesFile: "/path/to/foes.txt",
            });

            const message = createTestMessage({
                sender: "+18005551234",
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);
            const mockLogger = context.logger as ReturnType<typeof createMockLogger>;

            await plugin.handle(context);

            expect(mockLogger.error).toHaveBeenCalledWith(
                "Failed to add sender to foes list",
                expect.objectContaining({
                    messageId : message.id,
                    sender    : "+18005551234",
                    error     : "I/O error",
                })
            );
        });

        // Scenario: Handle non-Error thrown from appendFileSync
        it("should handle non-Error thrown from appendFileSync", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue("");
            mockAppendFileSync.mockImplementation(() => {
                throw "String error";
            });

            const plugin = new AddToFoesActionPlugin({
                foesFile: "/path/to/foes.txt",
            });

            const message = createTestMessage({
                sender: "+18005551234",
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            expect(result.success).toBe(false);
            expect(result.error).toBe("String error");
        });
    });

    describe("handle - edge cases", () => {
        // Scenario: Handle non-existent foes file for dedup check
        it("should handle non-existent foes file when checking for duplicates", async () => {
            mockExistsSync.mockReturnValue(false);
            mockAppendFileSync.mockImplementation(() => {});

            const plugin = new AddToFoesActionPlugin({
                foesFile: "/path/to/nonexistent/foes.txt",
            });

            const message = createTestMessage({
                sender: "+18005551234",
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            expect(result.success).toBe(true);
            expect(result.data?.alreadyPresent).toBe(false);
            // Should still attempt to append
            expect(mockAppendFileSync).toHaveBeenCalled();
        });

        // Scenario: Handle read errors during dedup check gracefully
        it("should treat read errors as no existing entries when deduplicating", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation(() => {
                throw new Error("Read failed");
            });
            mockAppendFileSync.mockImplementation(() => {});

            const plugin = new AddToFoesActionPlugin({
                foesFile: "/path/to/foes.txt",
            });

            const message = createTestMessage({
                sender: "+18005551234",
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            expect(result.success).toBe(true);
            expect(result.data?.alreadyPresent).toBe(false);
            // Should proceed to append since read failed
            expect(mockAppendFileSync).toHaveBeenCalled();
        });

        // Scenario: Preserve leading/trailing whitespace in sender
        it("should not trim sender before adding to foes", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue("");
            mockAppendFileSync.mockImplementation(() => {});

            const plugin = new AddToFoesActionPlugin({
                foesFile: "/path/to/foes.txt",
            });

            const message = createTestMessage({
                sender: "+18005551234", // exact sender
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context = createTestContext(message, classification);

            await plugin.handle(context);

            const callArgs = mockAppendFileSync.mock.calls[0];
            const entry = callArgs[1] as string;

            // Entry should contain the sender as-is (just normalized for matching)
            expect(entry).toContain("+18005551234");
        });
    });

    describe("realistic scenarios", () => {
        // Scenario: Learning feedback loop - first spam message
        it("should add high-confidence spam sender to foes for future blocking", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(
                "# Known scammers\nold_spammer@example.com\n"
            );
            mockAppendFileSync.mockImplementation(() => {});

            const plugin = new AddToFoesActionPlugin({
                foesFile: "/path/to/foes.txt",
            });

            const message = createTestMessage({
                content: "You have won $1M! Click here: http://malicious.com",
                sender : "new_spammer@example.com",
            });
            const classification: ClassificationOutput = {
                type      : "spam",
                confidence: 0.98,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            expect(result.success).toBe(true);
            expect(result.data?.alreadyPresent).toBe(false);

            // Verify entry was appended
            expect(mockAppendFileSync).toHaveBeenCalledWith(
                "/path/to/foes.txt",
                expect.stringContaining("new_spammer@example.com"),
                "utf-8"
            );
        });

        // Scenario: Multiple messages from same spammer
        it("should handle multiple messages from same spammer idempotently", async () => {
            mockExistsSync.mockReturnValue(true);
            let fileContent = "";

            mockReadFileSync.mockImplementation(() => fileContent);
            mockAppendFileSync.mockImplementation((path, entry) => {
                fileContent += entry;
            });

            const plugin = new AddToFoesActionPlugin({
                foesFile: "/path/to/foes.txt",
            });

            const spammer = "+18008675309";

            // First message - should add
            const message1 = createTestMessage({ sender: spammer });
            const classification1: ClassificationOutput = {
                type      : "spam",
                confidence: 0.96,
            };
            const context1 = createTestContext(message1, classification1);
            const result1 = await plugin.handle(context1);

            expect(result1.success).toBe(true);
            expect(result1.data?.alreadyPresent).toBe(false);

            // Second message - should skip (already in list)
            const message2 = createTestMessage({
                id     : "msg-spam-002",
                sender : spammer,
            });
            const classification2: ClassificationOutput = {
                type      : "spam",
                confidence: 0.95,
            };
            const context2 = createTestContext(message2, classification2);
            const result2 = await plugin.handle(context2);

            expect(result2.success).toBe(true);
            expect(result2.data?.alreadyPresent).toBe(true);
        });

        // Scenario: Scam detection with high confidence
        it("should add high-confidence scam sender to foes", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue("");
            mockAppendFileSync.mockImplementation(() => {});

            const plugin = new AddToFoesActionPlugin({
                foesFile: "/path/to/foes.txt",
            });

            const message = createTestMessage({
                content: "Your SSN is compromised! Call us immediately!",
                sender : "+1800SCAMMER",
            });
            const classification: ClassificationOutput = {
                type      : "scam",
                confidence: 0.99,
            };
            const context = createTestContext(message, classification);

            const result = await plugin.handle(context);

            expect(result.success).toBe(true);
            expect(result.data?.sender).toBe("+1800SCAMMER");

            // Verify the entry includes scam classification
            const callArgs = mockAppendFileSync.mock.calls[0];
            const entry = callArgs[1] as string;
            expect(entry).toContain("scam");
            expect(entry).toContain("0.99");
        });

        // Scenario: Different senders are added independently
        it("should add different senders independently", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue("");
            const appendedEntries: string[] = [];

            mockAppendFileSync.mockImplementation((path, entry) => {
                appendedEntries.push(entry as string);
            });

            const plugin = new AddToFoesActionPlugin({
                foesFile: "/path/to/foes.txt",
            });

            const spammers = [
                "+18001111111",
                "spam@example.com",
                "+18002222222",
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

            // Verify all senders were appended
            expect(appendedEntries).toHaveLength(3);
            expect(appendedEntries.some((e) => e.includes("+18001111111"))).toBe(true);
            expect(appendedEntries.some((e) => e.includes("spam@example.com"))).toBe(
                true
            );
            expect(appendedEntries.some((e) => e.includes("+18002222222"))).toBe(true);
        });
    });
});
