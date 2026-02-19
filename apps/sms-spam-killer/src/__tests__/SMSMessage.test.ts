/**
 * @fileoverview Unit tests for SMSMessage entity and factory
 *
 * Tests cover:
 * - createSMSMessage factory function
 * - isSMSMessage type guard
 * - Entity structure validation
 *
 * @module domain/__tests__/SMSMessage
 */

import { describe, it, expect } from "vitest";
import {
    createSMSMessage,
    isSMSMessage,
    type SMSMessage,
    type SMSMessageMetadata,
} from "../domain/entities/SMSMessage.js";
import type { Entity } from "@tagrouter/engine";

/**
 * Create realistic test metadata for SMS messages
 */
function createTestMetadata(overrides: Partial<SMSMessageMetadata> = {}): SMSMessageMetadata {
    return {
        sender   : "+15551234567",
        timestamp: new Date("2025-01-15T10:00:00.000Z"),
        isFromMe : false,
        isRead   : false,
        service  : "iMessage",
        chatId   : "chat-abc-123",
        guid     : "msg-guid-xyz-789",
        ...overrides,
    };
}

describe("createSMSMessage", () => {
    // Scenario: Create a basic SMS message with all required fields
    it("should create an SMS message with all provided fields", () => {
        const metadata = createTestMetadata();
        const message = createSMSMessage({
            id      : "msg-1",
            content : "Hello, this is a test message",
            metadata,
        });

        expect(message.id).toBe("msg-1");
        expect(message.content).toBe("Hello, this is a test message");
        expect(message.type).toBe("sms-message");
        expect(message.metadata).toEqual(metadata);
    });

    // Scenario: Message from device owner (isFromMe = true)
    it("should create a message from the device owner", () => {
        const metadata = createTestMetadata({ isFromMe: true });
        const message = createSMSMessage({
            id      : "msg-2",
            content : "Sent from me",
            metadata,
        });

        expect(message.metadata.isFromMe).toBe(true);
    });

    // Scenario: Message with SMS service instead of iMessage
    it("should handle SMS service type", () => {
        const metadata = createTestMetadata({ service: "SMS" });
        const message = createSMSMessage({
            id      : "msg-3",
            content : "SMS message",
            metadata,
        });

        expect(message.metadata.service).toBe("SMS");
    });

    // Scenario: Message with null chatId (no conversation)
    it("should handle null chatId", () => {
        const metadata = createTestMetadata({ chatId: null });
        const message = createSMSMessage({
            id      : "msg-4",
            content : "No chat ID",
            metadata,
        });

        expect(message.metadata.chatId).toBeNull();
    });

    // Scenario: Message with optional traceId
    it("should include traceId when provided", () => {
        const metadata = createTestMetadata();
        const message = createSMSMessage({
            id      : "msg-5",
            content : "With trace",
            metadata,
            traceId : "tr_abc123_def456",
        });

        expect(message.traceId).toBe("tr_abc123_def456");
    });

    // Scenario: Message without traceId
    it("should work without traceId", () => {
        const metadata = createTestMetadata();
        const message = createSMSMessage({
            id      : "msg-6",
            content : "No trace",
            metadata,
        });

        expect(message.traceId).toBeUndefined();
    });

    // Scenario: Empty content message
    it("should allow empty content", () => {
        const metadata = createTestMetadata();
        const message = createSMSMessage({
            id      : "msg-7",
            content : "",
            metadata,
        });

        expect(message.content).toBe("");
    });

    // Scenario: Message with email sender (iMessage allows email)
    it("should handle email sender for iMessage", () => {
        const metadata = createTestMetadata({ sender: "user@example.com" });
        const message = createSMSMessage({
            id      : "msg-8",
            content : "From email sender",
            metadata,
        });

        expect(message.metadata.sender).toBe("user@example.com");
    });

    // Scenario: Read message
    it("should handle read status", () => {
        const metadata = createTestMetadata({ isRead: true });
        const message = createSMSMessage({
            id      : "msg-9",
            content : "Already read",
            metadata,
        });

        expect(message.metadata.isRead).toBe(true);
    });
});

describe("isSMSMessage", () => {
    // Scenario: Valid SMS message returns true
    it("should return true for valid SMSMessage", () => {
        const message = createSMSMessage({
            id      : "msg-1",
            content : "Test",
            metadata: createTestMetadata(),
        });

        expect(isSMSMessage(message)).toBe(true);
    });

    // Scenario: Generic entity without type returns false
    it("should return false for generic Entity without type", () => {
        const entity: Entity<object> = {
            id      : "entity-1",
            content : "Test",
            metadata: { foo: "bar" },
        };

        expect(isSMSMessage(entity)).toBe(false);
    });

    // Scenario: Entity with different type returns false
    it("should return false for entity with different type", () => {
        const entity = {
            id      : "entity-1",
            content : "Test",
            metadata: { foo: "bar" },
            type    : "email-message",
        };

        expect(isSMSMessage(entity as Entity<object>)).toBe(false);
    });

    // Scenario: Entity with correct type but missing metadata still returns true
    it("should return true for entity with sms-message type", () => {
        const entity = {
            id      : "entity-1",
            content : "Test",
            metadata: {},
            type    : "sms-message",
        };

        expect(isSMSMessage(entity as Entity<object>)).toBe(true);
    });
});

describe("SMSMessage structure", () => {
    // Scenario: Message conforms to Entity interface
    it("should conform to Entity<SMSMessageMetadata> interface", () => {
        const message = createSMSMessage({
            id      : "msg-1",
            content : "Test",
            metadata: createTestMetadata(),
        });

        // These type checks ensure the structure is correct
        const _id: string = message.id;
        const _content: string = message.content;
        const _metadata: SMSMessageMetadata = message.metadata;
        const _type: "sms-message" = message.type;

        expect(_id).toBeDefined();
        expect(_content).toBeDefined();
        expect(_metadata).toBeDefined();
        expect(_type).toBe("sms-message");
    });

    // Scenario: Metadata contains all required fields
    it("should have all required metadata fields", () => {
        const message = createSMSMessage({
            id      : "msg-1",
            content : "Test",
            metadata: createTestMetadata(),
        });

        expect(message.metadata).toHaveProperty("sender");
        expect(message.metadata).toHaveProperty("timestamp");
        expect(message.metadata).toHaveProperty("isFromMe");
        expect(message.metadata).toHaveProperty("isRead");
        expect(message.metadata).toHaveProperty("service");
        expect(message.metadata).toHaveProperty("chatId");
        expect(message.metadata).toHaveProperty("guid");
    });
});

describe("realistic scenarios", () => {
    // Scenario: Incoming spam message
    it("should represent typical spam message", () => {
        const spamMessage = createSMSMessage({
            id      : "spam-msg-1",
            content : "URGENT: You have won $1,000,000! Click here to claim: bit.ly/scam123",
            metadata: {
                sender   : "+18005551234",
                timestamp: new Date("2025-01-15T08:30:00.000Z"),
                isFromMe : false,
                isRead   : false,
                service  : "SMS",
                chatId   : null,
                guid     : "spam-guid-001",
            },
        });

        expect(spamMessage.metadata.isFromMe).toBe(false);
        expect(spamMessage.metadata.service).toBe("SMS");
        expect(spamMessage.content).toContain("URGENT");
    });

    // Scenario: Personal message from known contact
    it("should represent personal message from contact", () => {
        const personalMessage = createSMSMessage({
            id      : "personal-msg-1",
            content : "Hey, are you free for lunch today?",
            metadata: {
                sender   : "+15551234567",
                timestamp: new Date("2025-01-15T11:00:00.000Z"),
                isFromMe : false,
                isRead   : true,
                service  : "iMessage",
                chatId   : "chat-friend-123",
                guid     : "personal-guid-001",
            },
        });

        expect(personalMessage.metadata.isRead).toBe(true);
        expect(personalMessage.metadata.service).toBe("iMessage");
        expect(personalMessage.metadata.chatId).not.toBeNull();
    });

    // Scenario: Marketing/promotional message
    it("should represent marketing message", () => {
        const marketingMessage = createSMSMessage({
            id      : "marketing-msg-1",
            content : "Flash sale! 50% off all items today only. Use code SAVE50",
            metadata: {
                sender   : "RETAILER",
                timestamp: new Date("2025-01-15T09:00:00.000Z"),
                isFromMe : false,
                isRead   : false,
                service  : "SMS",
                chatId   : null,
                guid     : "marketing-guid-001",
            },
        });

        expect(marketingMessage.metadata.sender).toBe("RETAILER");
        expect(marketingMessage.content).toContain("sale");
    });

    // Scenario: Two-factor authentication code
    it("should represent 2FA code message", () => {
        const twoFactorMessage = createSMSMessage({
            id      : "2fa-msg-1",
            content : "Your verification code is 847293. Do not share this code.",
            metadata: {
                sender   : "12345",
                timestamp: new Date("2025-01-15T10:15:00.000Z"),
                isFromMe : false,
                isRead   : true,
                service  : "SMS",
                chatId   : null,
                guid     : "2fa-guid-001",
            },
        });

        expect(twoFactorMessage.content).toMatch(/\d{6}/);
        expect(twoFactorMessage.metadata.isRead).toBe(true);
    });
});
