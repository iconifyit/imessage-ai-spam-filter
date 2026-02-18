/**
 * @fileoverview SMS Message Entity
 *
 * Domain-specific entity that extends the base Entity contract
 * with SMS/iMessage-specific metadata.
 *
 * @module domain/entities/SMSMessage
 */

import type { Entity } from "@tagrouter/engine";

/**
 * SMS/iMessage-specific metadata
 */
export interface SMSMessageMetadata {
    /** Phone number or email of the sender */
    readonly sender: string;

    /** Original message timestamp */
    readonly timestamp: Date;

    /** Whether the message is from the device owner */
    readonly isFromMe: boolean;

    /** Whether the message has been read */
    readonly isRead: boolean;

    /** Service type (iMessage, SMS) */
    readonly service: string;

    /** Chat/conversation ID */
    readonly chatId: string | null;

    /** Original message GUID from Messages.app */
    readonly guid: string;
}

/**
 * SMS Message Entity
 *
 * Represents an SMS or iMessage message flowing through the
 * TagRouter pipeline. Extends the base Entity with SMS-specific
 * metadata.
 */
export interface SMSMessage extends Entity<SMSMessageMetadata> {
    /** Entity type discriminator */
    readonly type: "sms-message";
}

/**
 * Input data for creating an SMSMessage (without type discriminator)
 */
export interface SMSMessageInput {
    /** Unique identifier */
    readonly id: string;

    /** Message content */
    readonly content: string;

    /** SMS-specific metadata */
    readonly metadata: SMSMessageMetadata;

    /** Optional trace ID */
    readonly traceId?: string;
}

/**
 * Factory function to create an SMSMessage entity.
 *
 * @param data - The message data
 * @returns A new SMSMessage entity with type discriminator
 *
 * @example
 * ```typescript
 * const message = createSMSMessage({
 *     id: "123",
 *     content: "Hello, this is a test message",
 *     metadata: {
 *         sender: "+15551234567",
 *         timestamp: new Date(),
 *         isFromMe: false,
 *         isRead: false,
 *         service: "iMessage",
 *         chatId: null,
 *         guid: "abc-123-def",
 *     },
 * });
 * ```
 */
export function createSMSMessage(data: SMSMessageInput): SMSMessage {
    return {
        ...data,
        type: "sms-message",
    };
}

/**
 * Type guard to check if an entity is an SMSMessage
 */
export function isSMSMessage(entity: Entity<object>): entity is SMSMessage {
    return "type" in entity && (entity as SMSMessage).type === "sms-message";
}
