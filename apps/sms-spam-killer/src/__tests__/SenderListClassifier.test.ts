/**
 * @fileoverview Unit tests for SenderListClassifier
 *
 * Tests cover:
 * - Matching logic: friends, foes, contacts lists
 * - Confidence levels: 1.0 for friends/foes, configurable for contacts
 * - Priority ordering: friends > foes > contacts
 * - Null return for unmatched senders (falls through to AI)
 * - File loading and reloading
 * - Edge cases: missing sender, missing files, empty lists
 *
 * @module domain/__tests__/SenderListClassifier
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SenderListClassifier } from "../domain/classifiers/SenderListClassifier.js";
import type { ClassificationContext } from "@tagrouter/engine";
import { createSMSMessage } from "../domain/entities/SMSMessage.js";

// Mock the fs module
vi.mock("fs", () => ({
    readFileSync : vi.fn(),
    existsSync   : vi.fn(),
}));

import { readFileSync, existsSync } from "fs";

const mockReadFileSync = vi.mocked(readFileSync);
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
        id      : overrides.id ?? "msg-test-001",
        content : overrides.content ?? "This is a test message",
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

/**
 * Create a classification context for testing.
 *
 * @returns ClassificationContext
 */
function createTestContext(): ClassificationContext {
    return {
        logger: createMockLogger(),
    };
}

describe("SenderListClassifier", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("constructor and file loading", () => {
        // Scenario: Constructor loads all three lists from disk
        it("should load friends, foes, and contacts lists on construction", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation((path) => {
                const pathStr = String(path);
                if (pathStr.includes("friends")) {
                    return "# Friends list\n+15551111111\nmother@example.com\n";
                }
                if (pathStr.includes("foes")) {
                    return "# Foes list\nspammer@example.com\n+18005551234\n";
                }
                if (pathStr.includes("contacts")) {
                    return JSON.stringify([
                        {
                            firstName : "Alice",
                            lastName  : "Smith",
                            name      : "Alice Smith",
                            email     : "alice@example.com",
                            phone     : "(555) 333-3333",
                        },
                    ]);
                }
                return "";
            });

            const classifier = new SenderListClassifier({
                friendsFile  : "/path/to/friends.txt",
                foesFile     : "/path/to/foes.txt",
                contactsFile : "/path/to/contacts.json",
            });

            expect(mockReadFileSync).toHaveBeenCalledWith("/path/to/friends.txt", "utf-8");
            expect(mockReadFileSync).toHaveBeenCalledWith("/path/to/foes.txt", "utf-8");
            expect(mockReadFileSync).toHaveBeenCalledWith("/path/to/contacts.json", "utf-8");

            const counts = classifier.listCounts;
            expect(counts.friends).toBe(2);
            expect(counts.foes).toBe(2);
            expect(counts.contacts).toBe(2); // phone and email from single contact
        });

        // Scenario: Missing files do not cause errors
        it("should handle missing files gracefully", () => {
            mockExistsSync.mockReturnValue(false);

            const classifier = new SenderListClassifier({
                friendsFile  : "/nonexistent/friends.txt",
                foesFile     : "/nonexistent/foes.txt",
                contactsFile : "/nonexistent/contacts.json",
            });

            const counts = classifier.listCounts;
            expect(counts.friends).toBe(0);
            expect(counts.foes).toBe(0);
            expect(counts.contacts).toBe(0);
        });

        // Scenario: Optional contactsFile omitted
        it("should work without contactsFile parameter", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation((path) => {
                const pathStr = String(path);
                if (pathStr.includes("friends")) {
                    return "+15551111111\n";
                }
                if (pathStr.includes("foes")) {
                    return "+18005551234\n";
                }
                return "";
            });

            const classifier = new SenderListClassifier({
                friendsFile: "/path/to/friends.txt",
                foesFile   : "/path/to/foes.txt",
            });

            const counts = classifier.listCounts;
            expect(counts.friends).toBe(1);
            expect(counts.foes).toBe(1);
            expect(counts.contacts).toBe(0);
        });
    });

    describe("classification - matching logic", () => {
        // Scenario: Sender matches friends list returns personal at confidence 1.0
        it("should return personal classification for friend sender", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation((path) => {
                const pathStr = String(path);
                if (pathStr.includes("friends")) {
                    return "+15551111111\nmother@example.com\n";
                }
                if (pathStr.includes("foes")) {
                    return "";
                }
                if (pathStr.includes("contacts")) {
                    return "[]";
                }
                return "";
            });

            const classifier = new SenderListClassifier({
                friendsFile  : "/path/to/friends.txt",
                foesFile     : "/path/to/foes.txt",
                contactsFile : "/path/to/contacts.json",
            });

            const message = createTestMessage({ sender: "+15551111111" });
            const context = createTestContext();

            const result = classifier.classify(message, context);

            expect(result).not.toBeNull();
            expect(result?.type).toBe("personal");
            expect(result?.confidence).toBe(1.0);
            expect(result?.tags).toContain("friends-list");
        });

        // Scenario: Sender matches foes list returns spam at confidence 1.0
        it("should return spam classification for foe sender", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation((path) => {
                const pathStr = String(path);
                if (pathStr.includes("friends")) {
                    return "";
                }
                if (pathStr.includes("foes")) {
                    return "+18005551234\nspammer@example.com\n";
                }
                if (pathStr.includes("contacts")) {
                    return "[]";
                }
                return "";
            });

            const classifier = new SenderListClassifier({
                friendsFile  : "/path/to/friends.txt",
                foesFile     : "/path/to/foes.txt",
                contactsFile : "/path/to/contacts.json",
            });

            const message = createTestMessage({ sender: "+18005551234" });
            const context = createTestContext();

            const result = classifier.classify(message, context);

            expect(result).not.toBeNull();
            expect(result?.type).toBe("spam");
            expect(result?.confidence).toBe(1.0);
            expect(result?.tags).toContain("foes-list");
        });

        // Scenario: Sender matches contacts list returns personal at default confidence 0.85
        it("should return personal classification for contact sender at default confidence", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation((path) => {
                const pathStr = String(path);
                if (pathStr.includes("friends")) {
                    return "";
                }
                if (pathStr.includes("foes")) {
                    return "";
                }
                if (pathStr.includes("contacts")) {
                    return JSON.stringify([
                        {
                            firstName : "John",
                            lastName  : "Doe",
                            name      : "John Doe",
                            email     : "john@example.com",
                            phone     : "+15553333333",
                        },
                    ]);
                }
                return "";
            });

            const classifier = new SenderListClassifier({
                friendsFile  : "/path/to/friends.txt",
                foesFile     : "/path/to/foes.txt",
                contactsFile : "/path/to/contacts.json",
            });

            const message = createTestMessage({ sender: "john@example.com" });
            const context = createTestContext();

            const result = classifier.classify(message, context);

            expect(result).not.toBeNull();
            expect(result?.type).toBe("personal");
            expect(result?.confidence).toBe(0.85);
            expect(result?.tags).toContain("contacts-list");
        });

        // Scenario: Sender matches contacts with custom confidence level
        it("should use custom confidence level for contacts", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation((path) => {
                const pathStr = String(path);
                if (pathStr.includes("friends")) {
                    return "";
                }
                if (pathStr.includes("foes")) {
                    return "";
                }
                if (pathStr.includes("contacts")) {
                    return JSON.stringify([
                        {
                            firstName : "Jane",
                            lastName  : "Smith",
                            name      : "Jane Smith",
                            email     : "jane@example.com",
                            phone     : "(555) 555-5555",
                        },
                    ]);
                }
                return "";
            });

            const classifier = new SenderListClassifier({
                friendsFile        : "/path/to/friends.txt",
                foesFile           : "/path/to/foes.txt",
                contactsFile       : "/path/to/contacts.json",
                contactsConfidence : 0.75,
            });

            const message = createTestMessage({ sender: "jane@example.com" });
            const context = createTestContext();

            const result = classifier.classify(message, context);

            expect(result?.confidence).toBe(0.75);
        });

        // Scenario: No match returns null
        it("should return null for unmatched sender", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation((path) => {
                const pathStr = String(path);
                if (pathStr.includes("friends")) {
                    return "+15551111111\n";
                }
                if (pathStr.includes("foes")) {
                    return "+18005551234\n";
                }
                if (pathStr.includes("contacts")) {
                    return "[]";
                }
                return "";
            });

            const classifier = new SenderListClassifier({
                friendsFile  : "/path/to/friends.txt",
                foesFile     : "/path/to/foes.txt",
                contactsFile : "/path/to/contacts.json",
            });

            const message = createTestMessage({ sender: "+15559999999" });
            const context = createTestContext();

            const result = classifier.classify(message, context);

            expect(result).toBeNull();
        });
    });

    describe("priority ordering", () => {
        // Scenario: Friends take priority over foes (same sender in both lists)
        it("should prioritize friends over foes when sender in both lists", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation((path) => {
                const pathStr = String(path);
                if (pathStr.includes("friends")) {
                    return "+15551234567\n";
                }
                if (pathStr.includes("foes")) {
                    return "+15551234567\n";
                }
                if (pathStr.includes("contacts")) {
                    return "[]";
                }
                return "";
            });

            const classifier = new SenderListClassifier({
                friendsFile  : "/path/to/friends.txt",
                foesFile     : "/path/to/foes.txt",
                contactsFile : "/path/to/contacts.json",
            });

            const message = createTestMessage({ sender: "+15551234567" });
            const context = createTestContext();

            const result = classifier.classify(message, context);

            // Should return friend classification, not foe
            expect(result?.type).toBe("personal");
            expect(result?.tags).toContain("friends-list");
        });

        // Scenario: Friends take priority over contacts
        it("should prioritize friends over contacts", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation((path) => {
                const pathStr = String(path);
                if (pathStr.includes("friends")) {
                    return "alice@example.com\n";
                }
                if (pathStr.includes("foes")) {
                    return "";
                }
                if (pathStr.includes("contacts")) {
                    return JSON.stringify([
                        {
                            firstName : "Alice",
                            lastName  : "Johnson",
                            name      : "Alice Johnson",
                            email     : "alice@example.com",
                            phone     : "+15553333333",
                        },
                    ]);
                }
                return "";
            });

            const classifier = new SenderListClassifier({
                friendsFile  : "/path/to/friends.txt",
                foesFile     : "/path/to/foes.txt",
                contactsFile : "/path/to/contacts.json",
            });

            const message = createTestMessage({ sender: "alice@example.com" });
            const context = createTestContext();

            const result = classifier.classify(message, context);

            // Should return friend classification at 1.0, not contact at 0.85
            expect(result?.confidence).toBe(1.0);
            expect(result?.tags).toContain("friends-list");
        });

        // Scenario: Foes take priority over contacts
        it("should prioritize foes over contacts", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation((path) => {
                const pathStr = String(path);
                if (pathStr.includes("friends")) {
                    return "";
                }
                if (pathStr.includes("foes")) {
                    return "badguy@example.com\n";
                }
                if (pathStr.includes("contacts")) {
                    return JSON.stringify([
                        {
                            firstName : "Bad",
                            lastName  : "Guy",
                            name      : "Bad Guy",
                            email     : "badguy@example.com",
                            phone     : "+15554444444",
                        },
                    ]);
                }
                return "";
            });

            const classifier = new SenderListClassifier({
                friendsFile  : "/path/to/friends.txt",
                foesFile     : "/path/to/foes.txt",
                contactsFile : "/path/to/contacts.json",
            });

            const message = createTestMessage({ sender: "badguy@example.com" });
            const context = createTestContext();

            const result = classifier.classify(message, context);

            // Should return spam (foes) classification at 1.0, not personal (contacts)
            expect(result?.type).toBe("spam");
            expect(result?.confidence).toBe(1.0);
            expect(result?.tags).toContain("foes-list");
        });
    });

    describe("edge cases", () => {
        // Scenario: Missing sender in message metadata returns null
        it("should return null when sender is missing from metadata", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue("");

            const classifier = new SenderListClassifier({
                friendsFile: "/path/to/friends.txt",
                foesFile   : "/path/to/foes.txt",
            });

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
            const context = createTestContext();

            const result = classifier.classify(message, context);

            expect(result).toBeNull();
        });

        // Scenario: Empty lists always return null
        it("should return null when all lists are empty", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue("");

            const classifier = new SenderListClassifier({
                friendsFile  : "/path/to/friends.txt",
                foesFile     : "/path/to/foes.txt",
                contactsFile : "/path/to/contacts.json",
            });

            const message = createTestMessage({ sender: "+15559876543" });
            const context = createTestContext();

            const result = classifier.classify(message, context);

            expect(result).toBeNull();
        });

        // Scenario: Case-insensitive matching works correctly
        it("should match senders case-insensitively", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation((path) => {
                const pathStr = String(path);
                if (pathStr.includes("friends")) {
                    return "MOTHER@EXAMPLE.COM\n";
                }
                if (pathStr.includes("foes")) {
                    return "";
                }
                if (pathStr.includes("contacts")) {
                    return "[]";
                }
                return "";
            });

            const classifier = new SenderListClassifier({
                friendsFile  : "/path/to/friends.txt",
                foesFile     : "/path/to/foes.txt",
                contactsFile : "/path/to/contacts.json",
            });

            const message = createTestMessage({ sender: "mother@example.com" });
            const context = createTestContext();

            const result = classifier.classify(message, context);

            expect(result?.type).toBe("personal");
            expect(result?.confidence).toBe(1.0);
        });

        // Scenario: Phone number variations match correctly
        it("should match phone numbers with formatting variations", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation((path) => {
                const pathStr = String(path);
                if (pathStr.includes("friends")) {
                    return "+1 (555) 123-4567\n";
                }
                if (pathStr.includes("foes")) {
                    return "";
                }
                if (pathStr.includes("contacts")) {
                    return "[]";
                }
                return "";
            });

            const classifier = new SenderListClassifier({
                friendsFile  : "/path/to/friends.txt",
                foesFile     : "/path/to/foes.txt",
                contactsFile : "/path/to/contacts.json",
            });

            // Send message from slightly different format
            const message = createTestMessage({ sender: "5551234567" });
            const context = createTestContext();

            const result = classifier.classify(message, context);

            expect(result?.type).toBe("personal");
            expect(result?.tags).toContain("friends-list");
        });
    });

    describe("listCounts", () => {
        // Scenario: listCounts returns correct counts
        it("should return accurate list counts", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation((path) => {
                const pathStr = String(path);
                if (pathStr.includes("friends")) {
                    return "# Comment\n+15551111111\nmother@example.com\n\n";
                }
                if (pathStr.includes("foes")) {
                    return "spam1@example.com\nspam2@example.com\nspam3@example.com\n";
                }
                if (pathStr.includes("contacts")) {
                    return JSON.stringify([
                        {
                            firstName : "Contact1",
                            lastName  : "Last1",
                            name      : "Contact1 Last1",
                            email     : "c1@example.com",
                            phone     : "+15554444444",
                        },
                        {
                            firstName : "Contact2",
                            lastName  : "Last2",
                            name      : "Contact2 Last2",
                            email     : "",
                            phone     : "+15555555555",
                        },
                    ]);
                }
                return "";
            });

            const classifier = new SenderListClassifier({
                friendsFile  : "/path/to/friends.txt",
                foesFile     : "/path/to/foes.txt",
                contactsFile : "/path/to/contacts.json",
            });

            const counts = classifier.listCounts;

            expect(counts.friends).toBe(2);
            expect(counts.foes).toBe(3);
            expect(counts.contacts).toBe(3); // 2 phones + 1 email
        });
    });

    describe("reloadLists", () => {
        // Scenario: reloadLists refreshes lists from disk
        it("should reload lists from disk when called", () => {
            mockExistsSync.mockReturnValue(true);
            let reloaded = false;

            mockReadFileSync.mockImplementation((path) => {
                const pathStr = String(path);

                // First load: 1 friend
                if (!reloaded) {
                    if (pathStr.includes("friends")) {
                        return "+15551111111\n";
                    }
                    if (pathStr.includes("foes")) {
                        return "";
                    }
                }
                // After reload: 2 friends
                else {
                    if (pathStr.includes("friends")) {
                        return "+15551111111\n+15552222222\n";
                    }
                    if (pathStr.includes("foes")) {
                        return "";
                    }
                }
                return "";
            });

            const classifier = new SenderListClassifier({
                friendsFile: "/path/to/friends.txt",
                foesFile   : "/path/to/foes.txt",
            });

            expect(classifier.listCounts.friends).toBe(1);

            // Reload lists
            reloaded = true;
            classifier.reloadLists();

            expect(classifier.listCounts.friends).toBe(2);
        });

        // Scenario: After reload, new sender matches
        it("should pick up new entries after reload", () => {
            mockExistsSync.mockReturnValue(true);
            let callCount = 0;

            mockReadFileSync.mockImplementation((path) => {
                const pathStr = String(path);
                callCount++;

                // First load: only mother is friend
                if (callCount <= 3) {
                    if (pathStr.includes("friends")) {
                        return "+15551111111\n";
                    }
                    if (pathStr.includes("foes")) {
                        return "";
                    }
                    if (pathStr.includes("contacts")) {
                        return "[]";
                    }
                }
                // After reload: father added as friend
                else {
                    if (pathStr.includes("friends")) {
                        return "+15551111111\n+15552222222\n";
                    }
                    if (pathStr.includes("foes")) {
                        return "";
                    }
                    if (pathStr.includes("contacts")) {
                        return "[]";
                    }
                }
                return "";
            });

            const classifier = new SenderListClassifier({
                friendsFile  : "/path/to/friends.txt",
                foesFile     : "/path/to/foes.txt",
                contactsFile : "/path/to/contacts.json",
            });

            // Before reload: father not a friend
            const messageBeforeReload = createTestMessage({ sender: "+15552222222" });
            const contextBefore = createTestContext();
            const resultBefore = classifier.classify(messageBeforeReload, contextBefore);
            expect(resultBefore).toBeNull();

            // Reload lists
            classifier.reloadLists();

            // After reload: father is now a friend
            const messageAfterReload = createTestMessage({ sender: "+15552222222" });
            const contextAfter = createTestContext();
            const resultAfter = classifier.classify(messageAfterReload, contextAfter);
            expect(resultAfter?.type).toBe("personal");
            expect(resultAfter?.confidence).toBe(1.0);
        });
    });

    describe("logging", () => {
        // Scenario: Friends match logs at debug level
        it("should log friends match at debug level", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation((path) => {
                const pathStr = String(path);
                if (pathStr.includes("friends")) {
                    return "+15551234567\n";
                }
                if (pathStr.includes("foes")) {
                    return "";
                }
                if (pathStr.includes("contacts")) {
                    return "[]";
                }
                return "";
            });

            const classifier = new SenderListClassifier({
                friendsFile  : "/path/to/friends.txt",
                foesFile     : "/path/to/foes.txt",
                contactsFile : "/path/to/contacts.json",
            });

            const message = createTestMessage({ sender: "+15551234567" });
            const context = createTestContext();
            const mockLogger = context.logger as ReturnType<typeof createMockLogger>;

            classifier.classify(message, context);

            expect(mockLogger.debug).toHaveBeenCalledWith(
                "Sender matched friends list",
                expect.objectContaining({
                    messageId : message.id,
                    sender    : "+15551234567",
                })
            );
        });

        // Scenario: Foes match logs at info level
        it("should log foes match at info level", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation((path) => {
                const pathStr = String(path);
                if (pathStr.includes("friends")) {
                    return "";
                }
                if (pathStr.includes("foes")) {
                    return "+18005551234\n";
                }
                if (pathStr.includes("contacts")) {
                    return "[]";
                }
                return "";
            });

            const classifier = new SenderListClassifier({
                friendsFile  : "/path/to/friends.txt",
                foesFile     : "/path/to/foes.txt",
                contactsFile : "/path/to/contacts.json",
            });

            const message = createTestMessage({ sender: "+18005551234" });
            const context = createTestContext();
            const mockLogger = context.logger as ReturnType<typeof createMockLogger>;

            classifier.classify(message, context);

            expect(mockLogger.info).toHaveBeenCalledWith(
                "Sender matched foes list",
                expect.objectContaining({
                    messageId : message.id,
                    sender    : "+18005551234",
                })
            );
        });
    });

    describe("realistic scenarios", () => {
        // Scenario: Mixed list with all entry types
        it("should handle realistic mixed lists correctly", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation((path) => {
                const pathStr = String(path);
                if (pathStr.includes("friends")) {
                    return "# My trusted contacts\n+15551111111\nmother@example.com\n";
                }
                if (pathStr.includes("foes")) {
                    return "# Known spammers\n+18005551234\nspammer@example.com\ncrypto alerts\n";
                }
                if (pathStr.includes("contacts")) {
                    return JSON.stringify([
                        {
                            firstName : "Alice",
                            lastName  : "Smith",
                            name      : "Alice Smith",
                            email     : "alice@example.com",
                            phone     : "(555) 333-3333",
                        },
                        {
                            firstName : "Bob",
                            lastName  : "Jones",
                            name      : "Bob Jones",
                            email     : "bob.jones@work.com",
                            phone     : "+15554444444",
                        },
                    ]);
                }
                return "";
            });

            const classifier = new SenderListClassifier({
                friendsFile  : "/path/to/friends.txt",
                foesFile     : "/path/to/foes.txt",
                contactsFile : "/path/to/contacts.json",
            });

            // Test each category
            const friendMsg = createTestMessage({ sender: "mother@example.com" });
            const friendCtx = createTestContext();
            expect(classifier.classify(friendMsg, friendCtx)?.type).toBe("personal");
            expect(classifier.classify(friendMsg, friendCtx)?.confidence).toBe(1.0);

            const foeMsg = createTestMessage({ sender: "spammer@example.com" });
            const foeCtx = createTestContext();
            expect(classifier.classify(foeMsg, foeCtx)?.type).toBe("spam");
            expect(classifier.classify(foeMsg, foeCtx)?.confidence).toBe(1.0);

            const contactMsg = createTestMessage({ sender: "alice@example.com" });
            const contactCtx = createTestContext();
            expect(classifier.classify(contactMsg, contactCtx)?.type).toBe("personal");
            expect(classifier.classify(contactMsg, contactCtx)?.confidence).toBe(0.85);

            const unknownMsg = createTestMessage({ sender: "+15559999999" });
            const unknownCtx = createTestContext();
            expect(classifier.classify(unknownMsg, unknownCtx)).toBeNull();
        });
    });
});
