/**
 * @fileoverview iMessage Entity Provider
 *
 * Implements the EntityProvider contract for SMS/iMessage messages.
 * Provides entities to the TagRouter engine by polling the chat.db database.
 *
 * @module domain/providers/iMessageEntityProvider
 */

import type {
    EntityProvider,
    FetchOptions,
    FetchResult,
} from "@tagrouter/engine";
import { ChatDatabase, type IMessage } from "../../adapters/imessage/services/chat-db.js";
import { createSMSMessage, type SMSMessage } from "../entities/SMSMessage.js";

/**
 * Configuration for the iMessage entity provider
 */
export interface IMessageProviderConfig {
    /** Path to the chat.db database (defaults to ~/Library/Messages/chat.db) */
    dbPath?: string;

    /** Default limit for fetching messages */
    defaultLimit?: number;

    /** Only fetch inbound messages (not from me) */
    inboundOnly?: boolean;
}

/**
 * iMessage Entity Provider
 *
 * Implements the pull-based EntityProvider contract.
 * Reads messages from the macOS Messages.app SQLite database.
 *
 * @example
 * ```typescript
 * const provider = new IMessageEntityProvider({
 *     defaultLimit: 50,
 *     inboundOnly: true,
 * });
 *
 * await provider.initialize();
 *
 * const result = await provider.getEntities({
 *     limit: 10,
 *     since: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
 * });
 *
 * for (const message of result.entities) {
 *     console.log(message.metadata.sender, message.content);
 * }
 * ```
 */
export class IMessageEntityProvider implements EntityProvider<SMSMessage> {
    readonly id = "imessage-provider";
    readonly name = "iMessage Provider";
    readonly description = "Provides SMS/iMessage messages from macOS Messages.app";

    private db: ChatDatabase;
    private config: {
        dbPath?: string;
        defaultLimit: number;
        inboundOnly: boolean;
    };
    private lastMessageId: number = 0;
    private initialized: boolean = false;

    constructor(config: IMessageProviderConfig = {}) {
        this.config = {
            dbPath      : config.dbPath,
            defaultLimit: config.defaultLimit ?? 100,
            inboundOnly : config.inboundOnly ?? true,
        };

        // ChatDatabase uses default path if undefined
        this.db = new ChatDatabase(this.config.dbPath);
    }

    /**
     * Initialize the provider by opening the database connection.
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        this.db.open();
        this.initialized = true;
    }

    /**
     * Fetch entities from the iMessage database.
     *
     * @param options - Fetch options (limit, since, etc.)
     * @returns Fetch result with SMSMessage entities
     */
    async getEntities(options: FetchOptions = {}): Promise<FetchResult<SMSMessage>> {
        if (!this.initialized) {
            throw new Error("Provider not initialized. Call initialize() first.");
        }

        const limit = options.limit ?? this.config.defaultLimit;

        // Parse cursor if provided (it's the last message ID)
        let sinceMessageId = 0;
        if (options.since) {
            if (typeof options.since === "string") {
                sinceMessageId = parseInt(options.since, 10);
            }
        }

        // Use cursor-based fetching if we have a previous cursor
        const cursor = sinceMessageId || this.lastMessageId;

        let rawMessages: IMessage[];

        if (cursor > 0) {
            // Fetch only new messages since the cursor
            rawMessages = this.db.getNewMessagesSince(cursor);

            // Apply limit
            if (rawMessages.length > limit) {
                rawMessages = rawMessages.slice(0, limit);
            }
        }
        else {
            // Initial fetch - get recent messages
            rawMessages = this.db.fetchMessages({
                limit,
                inboundOnly: this.config.inboundOnly,
            });
        }

        // Filter to inbound only if configured
        if (this.config.inboundOnly) {
            rawMessages = rawMessages.filter(m => !m.isFromMe);
        }

        // Convert to SMSMessage entities
        const entities = rawMessages.map(msg => this.messageToEntity(msg));

        // Update cursor to highest message ID
        if (rawMessages.length > 0) {
            const maxId = Math.max(...rawMessages.map(m => m.id));
            this.lastMessageId = Math.max(this.lastMessageId, maxId);
        }

        return {
            entities,
            cursor : this.lastMessageId.toString(),
            hasMore: rawMessages.length >= limit,
        };
    }

    /**
     * Shutdown the provider by closing the database connection.
     */
    async shutdown(): Promise<void> {
        this.db.close();
        this.initialized = false;
    }

    /**
     * Health check - verify database is accessible.
     */
    async isHealthy(): Promise<boolean> {
        try {
            if (!this.initialized) {
                return false;
            }

            // Try a simple query
            this.db.fetchMessages({ limit: 1 });
            return true;
        }
        catch {
            return false;
        }
    }

    /**
     * Convert an IMessage from the database to an SMSMessage entity.
     *
     * @param msg - The raw IMessage from the database
     * @returns SMSMessage entity for use in the classification pipeline
     */
    private messageToEntity(msg: IMessage): SMSMessage {
        return createSMSMessage({
            id      : msg.id.toString(),
            content : msg.text,
            metadata: {
                sender   : msg.sender,
                timestamp: msg.timestamp,
                isFromMe : msg.isFromMe,
                isRead   : msg.isRead,
                service  : msg.service,
                chatId   : msg.chatId,
                guid     : msg.guid,
            },
        });
    }

    /**
     * Get the current cursor position.
     */
    get currentCursor(): string {
        return this.lastMessageId.toString();
    }

    /**
     * Reset the cursor to start from the beginning.
     */
    resetCursor(): void {
        this.lastMessageId = 0;
    }
}
