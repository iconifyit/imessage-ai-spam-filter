/**
 * iMessage SQLite Database Reader
 *
 * Reads messages from macOS Messages.app database (chat.db).
 * This is a read-only service - it never modifies the database.
 *
 * Database location: ~/Library/Messages/chat.db
 * Requires Full Disk Access permission for the running process.
 */

import Database from "better-sqlite3";
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";

/**
 * Raw message row from the database
 */
export interface MessageRow {
    id: number;
    guid: string;
    text: string | null;
    handle_id: number;
    date: number;
    date_read: number;
    is_from_me: number;
    is_read: number;
    service: string;
    cache_roomnames: string | null;
}

/**
 * Raw handle (contact) row from the database
 */
export interface HandleRow {
    ROWID: number;
    id: string;
    service: string;
}

/**
 * Normalized message for external use
 */
export interface IMessage {
    id: number;
    guid: string;
    text: string;
    sender: string;
    timestamp: Date;
    isFromMe: boolean;
    isRead: boolean;
    service: string;
    chatId: string | null;
}

/**
 * Conversation summary
 */
export interface Conversation {
    chatId: string;
    participants: string[];
    lastMessage: string;
    lastMessageDate: Date;
    unreadCount: number;
}

/**
 * Options for fetching messages
 */
export interface FetchMessagesOptions {
    /** Fetch messages since this date */
    since?: Date;
    /** Maximum number of messages */
    limit?: number;
    /** Filter by sender identifier (phone/email) */
    sender?: string;
    /** Only unread messages */
    unreadOnly?: boolean;
    /** Only inbound messages (not from me) */
    inboundOnly?: boolean;
}

/**
 * Convert Apple's Core Data timestamp to JavaScript Date
 * Apple uses nanoseconds since 2001-01-01
 */
function appleTimestampToDate(timestamp: number): Date {
    // Apple epoch is 2001-01-01 00:00:00 UTC
    const APPLE_EPOCH = 978307200;
    // Timestamps are in nanoseconds, convert to seconds
    const seconds = timestamp / 1_000_000_000;
    return new Date((seconds + APPLE_EPOCH) * 1000);
}

/**
 * Convert JavaScript Date to Apple timestamp
 */
function dateToAppleTimestamp(date: Date): number {
    const APPLE_EPOCH = 978307200;
    const seconds = date.getTime() / 1000 - APPLE_EPOCH;
    return seconds * 1_000_000_000;
}

/**
 * iMessage database reader
 */
export class ChatDatabase {
    private db: Database.Database | null = null;
    private dbPath: string;

    constructor(dbPath?: string) {
        this.dbPath = dbPath ?? join(homedir(), "Library", "Messages", "chat.db");
    }

    /**
     * Open the database connection
     */
    open(): void {
        if (this.db) {
            return;
        }

        if (!existsSync(this.dbPath)) {
            throw new Error(
                `Messages database not found at ${this.dbPath}. ` +
                `Make sure you're running on macOS and have Full Disk Access enabled.`
            );
        }

        try {
            this.db = new Database(this.dbPath, { readonly: true });
        }
        catch (error) {
            if (error instanceof Error && error.message.includes("SQLITE_CANTOPEN")) {
                throw new Error(
                    `Cannot open Messages database. Please grant Full Disk Access:\n` +
                    `1. Open System Settings > Privacy & Security > Full Disk Access\n` +
                    `2. Add your terminal app or Node.js`
                );
            }
            throw error;
        }
    }

    /**
     * Close the database connection
     */
    close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    /**
     * Ensure database is open
     */
    private ensureOpen(): Database.Database {
        if (!this.db) {
            this.open();
        }
        return this.db!;
    }

    /**
     * Get handle (sender) by ID
     */
    getHandle(handleId: number): HandleRow | null {
        const db = this.ensureOpen();
        const stmt = db.prepare(`
            SELECT ROWID, id, service
            FROM handle
            WHERE ROWID = ?
        `);
        return stmt.get(handleId) as HandleRow | null;
    }

    /**
     * Fetch messages with options
     */
    fetchMessages(options: FetchMessagesOptions = {}): IMessage[] {
        const db = this.ensureOpen();

        const conditions: string[] = [];
        const params: (string | number)[] = [];

        // Build WHERE clause
        if (options.since) {
            conditions.push("m.date > ?");
            params.push(dateToAppleTimestamp(options.since));
        }

        if (options.unreadOnly) {
            conditions.push("m.is_read = 0");
            conditions.push("m.is_from_me = 0");
        }

        if (options.inboundOnly) {
            conditions.push("m.is_from_me = 0");
        }

        if (options.sender) {
            conditions.push("h.id = ?");
            params.push(options.sender);
        }

        // Filter out empty messages
        conditions.push("m.text IS NOT NULL");
        conditions.push("m.text != ''");

        const whereClause = conditions.length > 0
            ? `WHERE ${conditions.join(" AND ")}`
            : "";

        const limitClause = options.limit ? `LIMIT ${options.limit}` : "";

        const query = `
            SELECT
                m.ROWID as id,
                m.guid,
                m.text,
                m.handle_id,
                m.date,
                m.date_read,
                m.is_from_me,
                m.is_read,
                m.service,
                m.cache_roomnames
            FROM message m
            LEFT JOIN handle h ON m.handle_id = h.ROWID
            ${whereClause}
            ORDER BY m.date DESC
            ${limitClause}
        `;

        const stmt = db.prepare(query);
        const rows = stmt.all(...params) as MessageRow[];

        return rows.map(row => this.rowToMessage(row));
    }

    /**
     * Get unread messages
     */
    getUnreadMessages(limit?: number): IMessage[] {
        return this.fetchMessages({
            unreadOnly: true,
            limit,
        });
    }

    /**
     * Get messages from a specific sender
     */
    getMessagesFromSender(sender: string, limit?: number): IMessage[] {
        return this.fetchMessages({
            sender,
            limit,
        });
    }

    /**
     * Get recent conversations
     */
    getConversations(limit: number = 20): Conversation[] {
        const db = this.ensureOpen();

        const query = `
            SELECT
                COALESCE(m.cache_roomnames, h.id) as chat_id,
                h.id as participant,
                m.text as last_message,
                m.date as last_date,
                SUM(CASE WHEN m.is_read = 0 AND m.is_from_me = 0 THEN 1 ELSE 0 END) as unread_count
            FROM message m
            LEFT JOIN handle h ON m.handle_id = h.ROWID
            WHERE m.text IS NOT NULL AND m.text != ''
            GROUP BY COALESCE(m.cache_roomnames, h.id)
            ORDER BY m.date DESC
            LIMIT ?
        `;

        const stmt = db.prepare(query);
        const rows = stmt.all(limit) as Array<{
            chat_id: string;
            participant: string;
            last_message: string;
            last_date: number;
            unread_count: number;
        }>;

        return rows.map(row => ({
            chatId         : row.chat_id,
            participants   : [row.participant].filter(Boolean),
            lastMessage    : row.last_message,
            lastMessageDate: appleTimestampToDate(row.last_date),
            unreadCount    : row.unread_count,
        }));
    }

    /**
     * Get messages with flexible options (used by MCP tools)
     */
    getMessages(options: {
        chatId?: string;
        limit?: number;
        beforeDate?: Date;
        afterDate?: Date;
    } = {}): IMessage[] {
        const db = this.ensureOpen();

        const conditions: string[] = [];
        const params: (string | number)[] = [];

        if (options.chatId) {
            conditions.push("(m.cache_roomnames = ? OR h.id = ?)");
            params.push(options.chatId, options.chatId);
        }

        if (options.beforeDate) {
            conditions.push("m.date < ?");
            params.push(dateToAppleTimestamp(options.beforeDate));
        }

        if (options.afterDate) {
            conditions.push("m.date > ?");
            params.push(dateToAppleTimestamp(options.afterDate));
        }

        conditions.push("m.text IS NOT NULL");
        conditions.push("m.text != ''");

        const whereClause = conditions.length > 0
            ? `WHERE ${conditions.join(" AND ")}`
            : "";

        const limitClause = options.limit ? `LIMIT ${options.limit}` : "LIMIT 50";

        const query = `
            SELECT
                m.ROWID as id,
                m.guid,
                m.text,
                m.handle_id,
                m.date,
                m.date_read,
                m.is_from_me,
                m.is_read,
                m.service,
                m.cache_roomnames
            FROM message m
            LEFT JOIN handle h ON m.handle_id = h.ROWID
            ${whereClause}
            ORDER BY m.date DESC
            ${limitClause}
        `;

        const stmt = db.prepare(query);
        const rows = stmt.all(...params) as MessageRow[];
        return rows.map(row => this.rowToMessage(row));
    }

    /**
     * Get new messages since a specific message ID (for polling)
     */
    getNewMessagesSince(lastMessageId: number): IMessage[] {
        const db = this.ensureOpen();

        const stmt = db.prepare(`
            SELECT
                m.ROWID as id,
                m.guid,
                m.text,
                m.handle_id,
                m.date,
                m.date_read,
                m.is_from_me,
                m.is_read,
                m.service,
                m.cache_roomnames
            FROM message m
            WHERE m.ROWID > ?
                AND m.text IS NOT NULL
                AND m.text != ''
            ORDER BY m.ROWID ASC
        `);

        const rows = stmt.all(lastMessageId) as MessageRow[];
        return rows.map(row => this.rowToMessage(row));
    }

    /**
     * Search messages by text content
     */
    searchMessages(query: string, limit: number = 50): IMessage[] {
        const db = this.ensureOpen();

        const stmt = db.prepare(`
            SELECT
                m.ROWID as id,
                m.guid,
                m.text,
                m.handle_id,
                m.date,
                m.date_read,
                m.is_from_me,
                m.is_read,
                m.service,
                m.cache_roomnames
            FROM message m
            WHERE m.text LIKE ?
            ORDER BY m.date DESC
            LIMIT ?
        `);

        const rows = stmt.all(`%${query}%`, limit) as MessageRow[];
        return rows.map(row => this.rowToMessage(row));
    }

    /**
     * Convert database row to IMessage
     */
    private rowToMessage(row: MessageRow): IMessage {
        const handle = row.handle_id ? this.getHandle(row.handle_id) : null;

        return {
            id       : row.id,
            guid     : row.guid,
            text     : row.text ?? "",
            sender   : handle?.id ?? "unknown",
            timestamp: appleTimestampToDate(row.date),
            isFromMe : row.is_from_me === 1,
            isRead   : row.is_read === 1,
            service  : row.service ?? "iMessage",
            chatId   : row.cache_roomnames,
        };
    }
}
