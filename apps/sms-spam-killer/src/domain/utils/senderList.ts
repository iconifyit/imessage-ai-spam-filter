/**
 * @fileoverview Sender List Utilities
 *
 * Functions for parsing and matching against sender lists (friends, foes, contacts).
 * Ported from v1's SenderFilter.ts with identical matching semantics.
 *
 * Supports three list formats:
 * - Text files (friends.txt, foes.txt): one entry per line, # comments
 * - JSON files (contacts.json): array of contact objects from macOS Contacts.app
 *
 * @module domain/utils/senderList
 */

import { readFileSync, existsSync } from "fs";

/**
 * Shape of a contact entry in contacts.json, as exported from macOS Contacts.app.
 */
export interface ContactEntry {
    /** Contact's first name */
    readonly firstName: string;

    /** Contact's last name */
    readonly lastName: string;

    /** Full display name */
    readonly name: string;

    /** Email address (may be empty string) */
    readonly email: string;

    /** Phone number in various formats (may be empty string) */
    readonly phone: string;
}

/**
 * Minimum number of digits required for phone number suffix matching.
 * Prevents false positives on very short numbers or codes.
 */
const kMIN_PHONE_DIGITS = 7;

/**
 * Parse a text-based list file (friends.txt or foes.txt).
 *
 * Reads a file line by line, ignoring:
 * - Empty lines
 * - Lines starting with # (comments)
 *
 * All entries are normalized to lowercase and trimmed.
 *
 * @param filePath - Absolute path to the list file
 * @returns Array of normalized entries (lowercase, trimmed). Empty array if file doesn't exist or can't be read.
 *
 * @example
 * ```typescript
 * // Given friends.txt:
 * // # My trusted contacts
 * // +15551234567
 * // mom@icloud.com
 * //
 * // Dad
 *
 * const friends = parseListFile("/path/to/friends.txt");
 * // => ["+15551234567", "mom@icloud.com", "dad"]
 * ```
 */
export function parseListFile(filePath: string): string[] {
    if (!existsSync(filePath)) {
        return [];
    }

    try {
        const content = readFileSync(filePath, "utf-8");
        return content
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#"))
            .map((line) => line.toLowerCase());
    }
    catch (error) {
        console.error(`Error reading list file ${filePath}:`, error);
        return [];
    }
}

/**
 * Parse a contacts.json file exported from macOS Contacts.app.
 *
 * Extracts phone numbers and email addresses from each contact,
 * normalizing them to lowercase. Entries with neither phone nor
 * email are skipped.
 *
 * @param filePath - Absolute path to the contacts.json file
 * @returns Array of normalized sender identifiers (phone numbers and emails, lowercase)
 *
 * @example
 * ```typescript
 * // Given contacts.json:
 * // [{ "name": "Mom", "phone": "(804) 555-1234", "email": "mom@icloud.com" }]
 *
 * const contacts = parseContactsFile("/path/to/contacts.json");
 * // => ["(804) 555-1234", "mom@icloud.com"]
 * ```
 */
export function parseContactsFile(filePath: string): string[] {
    if (!existsSync(filePath)) {
        return [];
    }

    try {
        const content = readFileSync(filePath, "utf-8");
        const contacts: ContactEntry[] = JSON.parse(content);

        if (!Array.isArray(contacts)) {
            console.error(`Contacts file is not an array: ${filePath}`);
            return [];
        }

        const entries: string[] = [];

        for (const contact of contacts) {
            if (contact.phone) {
                entries.push(contact.phone.toLowerCase());
            }
            if (contact.email) {
                entries.push(contact.email.toLowerCase());
            }
        }

        return entries;
    }
    catch (error) {
        console.error(`Error reading contacts file ${filePath}:`, error);
        return [];
    }
}

/**
 * Check if a sender matches any entry in a list.
 *
 * Uses three matching strategies in order:
 * 1. **Exact match** — case-insensitive string comparison
 * 2. **Partial match** — sender contains entry or entry contains sender
 *    (handles display names, short codes, email variations)
 * 3. **Phone number normalization** — strips non-digit characters and compares
 *    suffixes, handling country code variations (+1, etc.). Requires at least
 *    {@link kMIN_PHONE_DIGITS} digits on both sides to avoid false positives.
 *
 * @param sender - The sender identifier (phone number, email, or display name)
 * @param list - Array of normalized list entries to match against
 * @returns True if the sender matches any entry in the list
 *
 * @example
 * ```typescript
 * const foes = ["+18005551234", "spam@example.com", "crypto alerts"];
 *
 * senderMatchesList("+18005551234", foes);    // true — exact match
 * senderMatchesList("8005551234", foes);       // true — phone normalization
 * senderMatchesList("Crypto Alerts", foes);    // true — partial match (case-insensitive)
 * senderMatchesList("+15559999999", foes);     // false — no match
 * ```
 */
export function senderMatchesList(sender: string, list: string[]): boolean {
    if (!sender || list.length === 0) {
        return false;
    }

    const normalizedSender = sender.toLowerCase();

    return list.some((entry) => {
        // Exact match
        if (normalizedSender === entry) {
            return true;
        }

        // Partial match (sender contains entry or entry contains sender)
        if (normalizedSender.includes(entry) || entry.includes(normalizedSender)) {
            return true;
        }

        // Phone number normalization: strip non-digits and compare suffixes
        const senderDigits = normalizedSender.replace(/\D/g, "");
        const entryDigits  = entry.replace(/\D/g, "");

        if (senderDigits.length >= kMIN_PHONE_DIGITS && entryDigits.length >= kMIN_PHONE_DIGITS) {
            if (senderDigits.endsWith(entryDigits) || entryDigits.endsWith(senderDigits)) {
                return true;
            }
        }

        return false;
    });
}
