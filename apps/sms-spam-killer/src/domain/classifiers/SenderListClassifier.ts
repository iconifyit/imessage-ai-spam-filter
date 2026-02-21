/**
 * @fileoverview Sender List Classification Plugin
 *
 * Implements the ClassificationPlugin contract for sender-based classification.
 * Checks incoming message senders against three ordered lists:
 *
 * 1. **Friends** — trusted senders → `personal` at confidence 1.0
 * 2. **Foes** — known spammers → `spam` at confidence 1.0
 * 3. **Contacts** — address book entries → `personal` at confidence 0.85
 *
 * Returns null for unmatched senders, allowing the AI classifier to handle them.
 *
 * @see {@link ../../docs/adr/ADR-002-sender-lists.md} for design rationale
 * @module domain/classifiers/SenderListClassifier
 */

import type {
    ClassificationPlugin,
    ClassificationContext,
    ClassificationOutput,
    Entity,
} from "@tagrouter/engine";

import {
    parseListFile,
    parseContactsFile,
    senderMatchesList,
} from "../utils/senderList.js";

/**
 * Configuration options for the SenderListClassifier.
 */
export interface SenderListClassifierConfig {
    /** Absolute path to friends.txt */
    readonly friendsFile: string;

    /** Absolute path to foes.txt */
    readonly foesFile: string;

    /** Absolute path to contacts.json (optional — omit to skip contacts matching) */
    readonly contactsFile?: string;

    /**
     * Confidence level for contacts matches.
     * Defaults to 0.85 — high enough that AI needs strong evidence to override,
     * but not absolute like friends/foes.
     */
    readonly contactsConfidence?: number;
}

/**
 * Default confidence for contacts matches.
 * High trust, but the AI can override with strong evidence.
 */
const kDEFAULT_CONTACTS_CONFIDENCE = 0.85;

/**
 * Sender List Classifier
 *
 * A static classifier that checks message senders against friends, foes,
 * and contacts lists. Because it returns confidence 1.0 for friends/foes
 * matches, it naturally wins over the AI classifier in the engine's
 * confidence resolution — no special short-circuiting needed.
 *
 * @example
 * ```typescript
 * const classifier = new SenderListClassifier({
 *     friendsFile  : "/path/to/friends.txt",
 *     foesFile     : "/path/to/foes.txt",
 *     contactsFile : "/path/to/contacts.json",
 * });
 *
 * const result = classifier.classify(message, context);
 * // Friend  → { type: "personal", confidence: 1.0, tags: ["friends-list"] }
 * // Foe     → { type: "spam", confidence: 1.0, tags: ["foes-list"] }
 * // Contact → { type: "personal", confidence: 0.85, tags: ["contacts-list"] }
 * // Unknown → null (falls through to AI)
 * ```
 */
export class SenderListClassifier implements ClassificationPlugin {
    readonly id          : string;
    readonly name        = "Sender List Classifier";
    readonly description = "Classifies messages by matching senders against friends, foes, and contacts lists";

    private friends: string[]            = [];
    private foes: string[]               = [];
    private contacts: string[]           = [];
    private contactsConfidence: number;
    private config: SenderListClassifierConfig;

    /**
     * Create a new SenderListClassifier.
     *
     * Lists are loaded from disk immediately upon construction.
     * If a file does not exist or cannot be read, the corresponding
     * list is treated as empty (no matches, no errors).
     *
     * @param config - Paths to list files and optional confidence settings
     * @param id - Optional custom plugin ID (defaults to "sender-list-classifier")
     */
    constructor(config: SenderListClassifierConfig, id: string = "sender-list-classifier") {
        this.id                 = id;
        this.config             = config;
        this.contactsConfidence = config.contactsConfidence ?? kDEFAULT_CONTACTS_CONFIDENCE;

        this.loadLists();
    }

    /**
     * Classify a message by checking its sender against the loaded lists.
     *
     * Check order: friends → foes → contacts. Returns on first match.
     * This is a synchronous classifier — no async needed since lists are in memory.
     *
     * @param message - The message entity to classify (read-only)
     * @param context - Classification context with logger
     * @returns ClassificationOutput if sender matches a list, or null if no match
     */
    classify(
        message: Entity<object>,
        context: ClassificationContext
    ): ClassificationOutput | null {
        const sender = (message.metadata as { sender?: string })?.sender;

        if (!sender) {
            return null;
        }

        // Check friends list — trusted senders, never flagged as spam
        if (senderMatchesList(sender, this.friends)) {
            context.logger.debug("Sender matched friends list", {
                messageId : message.id,
                sender,
            });

            return {
                type       : "personal",
                confidence : 1.0,
                tags       : ["friends-list"],
            };
        }

        // Check foes list — known spammers, always flagged
        if (senderMatchesList(sender, this.foes)) {
            context.logger.info("Sender matched foes list", {
                messageId : message.id,
                sender,
            });

            return {
                type       : "spam",
                confidence : 1.0,
                tags       : ["foes-list"],
            };
        }

        // Check contacts list — known people, high but not absolute confidence
        if (senderMatchesList(sender, this.contacts)) {
            context.logger.debug("Sender matched contacts list", {
                messageId : message.id,
                sender,
            });

            return {
                type       : "personal",
                confidence : this.contactsConfidence,
                tags       : ["contacts-list"],
            };
        }

        // No match — fall through to AI classifier
        return null;
    }

    /**
     * Get the number of entries in each loaded list.
     * Useful for logging and diagnostics.
     *
     * @returns Object with counts for each list
     */
    get listCounts(): { friends: number; foes: number; contacts: number } {
        return {
            contacts : this.contacts.length,
            foes     : this.foes.length,
            friends  : this.friends.length,
        };
    }

    /**
     * Reload all lists from disk.
     *
     * Call this to pick up changes to list files without restarting
     * the application.
     */
    reloadLists(): void {
        this.loadLists();
    }

    /**
     * Load all lists from their configured file paths.
     * Called during construction and on manual reload.
     */
    private loadLists(): void {
        this.friends  = parseListFile(this.config.friendsFile);
        this.foes     = parseListFile(this.config.foesFile);
        this.contacts = this.config.contactsFile
            ? parseContactsFile(this.config.contactsFile)
            : [];
    }
}
