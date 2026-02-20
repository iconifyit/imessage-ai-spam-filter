/**
 * AppleScript executor for iMessage actions
 *
 * Uses osascript to interact with Messages.app for operations
 * that require write access (sending messages, etc.)
 */

import { spawn } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Result of an AppleScript execution
 * @property {boolean} success - Whether the script executed successfully (exit code 0)
 * @property {string} [output] - The stdout output from the script
 * @property {string} [error] - Error message from stderr or execution failure
 */
export interface AppleScriptResult {
    success: boolean;
    output?: string;
    error?: string;
}

/**
 * Execute raw AppleScript using a temp file
 *
 * This function writes the script to a temporary file and executes it via `osascript`.
 * Using a temp file is more reliable than the `-e` flag for multi-line scripts
 * because it avoids shell escaping issues.
 *
 * @param {string} script - The AppleScript code to execute
 * @returns {Promise<AppleScriptResult>} Result with success status and output/error
 *
 * @example
 * const result = await runAppleScript(`
 *     tell application "Messages"
 *         return count of chats
 *     end tell
 * `);
 * if (result.success) {
 *     console.log("Chat count:", result.output);
 * }
 */
export async function runAppleScript(script: string): Promise<AppleScriptResult> {
    // Write script to temp file - more reliable than -e for multi-line scripts
    const tempFile = join(tmpdir(), `applescript-${Date.now()}.scpt`);

    try {
        writeFileSync(tempFile, script, "utf-8");

        return new Promise((resolve) => {
            const proc = spawn("osascript", [tempFile], {
                timeout: 300000, // 5 minute timeout for iterating through many conversations
            });

            let stdout = "";
            let stderr = "";

            proc.stdout.on("data", (data) => {
                stdout += data.toString();
            });

            proc.stderr.on("data", (data) => {
                stderr += data.toString();
            });

            proc.on("close", (code) => {
                // Clean up temp file
                try {
                    unlinkSync(tempFile);
                }
                catch {
                    // Ignore cleanup errors
                }

                if (code === 0) {
                    resolve({
                        success: true,
                        output : stdout.trim(),
                        error  : stderr.trim() || undefined,
                    });
                }
                else {
                    resolve({
                        success: false,
                        error  : stderr.trim() || stdout.trim() || `Exit code ${code}`,
                    });
                }
            });

            proc.on("error", (err) => {
                // Clean up temp file
                try {
                    unlinkSync(tempFile);
                }
                catch {
                    // Ignore cleanup errors
                }

                resolve({
                    success: false,
                    error  : err.message,
                });
            });
        });
    }
    catch (error) {
        // Clean up temp file on error
        try {
            unlinkSync(tempFile);
        }
        catch {
            // Ignore cleanup errors
        }

        const err = error as Error;
        return {
            success: false,
            error  : err.message || "Unknown AppleScript error",
        };
    }
}

/**
 * Escape a string for safe use within AppleScript string literals
 *
 * Escapes special characters that would break AppleScript string parsing:
 * - Backslashes (\\) → (\\\\)
 * - Double quotes (") → (\")
 * - Newlines → (\\n)
 * - Carriage returns → (\\r)
 * - Tabs → (\\t)
 *
 * @param {string} str - The string to escape
 * @returns {string} The escaped string safe for AppleScript
 *
 * @example
 * const escaped = escapeForAppleScript('Say "hello"');
 * // Returns: 'Say \\"hello\\"'
 */
function escapeForAppleScript(str: string): string {
    return str
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
}

/**
 * Send a message via SMS
 *
 * @param recipient - Phone number
 * @param message - Message text to send
 * @returns Result of the send operation
 */
export async function sendMessage(
    recipient: string,
    message: string
): Promise<AppleScriptResult> {
    const escapedRecipient = escapeForAppleScript(recipient);
    const escapedMessage = escapeForAppleScript(message);

    // Try to find existing chat with this participant and send to it
    const script = `
        tell application "Messages"
            set targetChat to missing value
            repeat with aChat in chats
                repeat with p in participants of aChat
                    if handle of p contains "${escapedRecipient}" then
                        set targetChat to aChat
                        exit repeat
                    end if
                end repeat
                if targetChat is not missing value then exit repeat
            end repeat

            if targetChat is missing value then
                error "No existing chat found with ${escapedRecipient}"
            end if

            send "${escapedMessage}" to targetChat
        end tell
    `;

    return runAppleScript(script);
}

/**
 * Send a message to a group chat
 *
 * @param chatId - The chat identifier (group name or ID)
 * @param message - Message text to send
 * @returns Result of the send operation
 */
export async function sendToChat(
    chatId: string,
    message: string
): Promise<AppleScriptResult> {
    const escapedChatId = escapeForAppleScript(chatId);
    const escapedMessage = escapeForAppleScript(message);

    const script = `
        tell application "Messages"
            set targetChat to chat "${escapedChatId}"
            send "${escapedMessage}" to targetChat
        end tell
    `;

    return runAppleScript(script);
}

/**
 * Open a conversation in Messages.app
 *
 * @param recipient - Phone number or email to open chat with
 */
export async function openChat(recipient: string): Promise<AppleScriptResult> {
    const escapedRecipient = escapeForAppleScript(recipient);

    const script = `
        tell application "Messages"
            activate
            set targetService to 1st account whose service type = iMessage
            set targetBuddy to participant "${escapedRecipient}" of targetService
            -- Opening a new message window
            tell application "System Events"
                tell process "Messages"
                    click menu item "New Message" of menu "File" of menu bar 1
                end tell
            end tell
        end tell
    `;

    return runAppleScript(script);
}

/**
 * Check if Messages.app is running
 */
export async function isMessagesRunning(): Promise<boolean> {
    const script = `
        tell application "System Events"
            set isRunning to (name of processes) contains "Messages"
        end tell
        return isRunning
    `;

    const result = await runAppleScript(script);
    return result.success && result.output === "true";
}

/**
 * Activate (bring to front) Messages.app
 */
export async function activateMessages(): Promise<AppleScriptResult> {
    const script = `
        tell application "Messages"
            activate
        end tell
    `;

    return runAppleScript(script);
}

/**
 * Show a macOS notification
 *
 * @param title - Notification title
 * @param message - Notification body text
 * @param subtitle - Optional subtitle
 * @param sound - Optional sound name (e.g., "default", "Basso", "Blow")
 */
export async function showNotification(
    title: string,
    message: string,
    subtitle?: string,
    sound?: string
): Promise<AppleScriptResult> {
    const escapedTitle = escapeForAppleScript(title);
    const escapedMessage = escapeForAppleScript(message);
    const escapedSubtitle = subtitle ? escapeForAppleScript(subtitle) : "";

    let script = `display notification "${escapedMessage}" with title "${escapedTitle}"`;

    if (subtitle) {
        script += ` subtitle "${escapedSubtitle}"`;
    }

    if (sound) {
        script += ` sound name "${sound}"`;
    }

    return runAppleScript(script);
}

/**
 * Speak text using macOS text-to-speech
 *
 * @param text - Text to speak
 * @param voice - Optional voice name (e.g., "Alex", "Samantha")
 */
export async function speakText(
    text: string,
    voice?: string
): Promise<AppleScriptResult> {
    const escapedText = escapeForAppleScript(text);

    let script = `say "${escapedText}"`;
    if (voice) {
        script += ` using "${voice}"`;
    }

    return runAppleScript(script);
}

/**
 * Copy text to clipboard
 *
 * @param text - Text to copy
 */
export async function copyToClipboard(text: string): Promise<AppleScriptResult> {
    const escapedText = escapeForAppleScript(text);

    const script = `set the clipboard to "${escapedText}"`;

    return runAppleScript(script);
}

/**
 * Get the number of unread messages in Messages.app
 * Note: This is approximate - Messages.app doesn't expose this directly
 */
export async function getUnreadCount(): Promise<AppleScriptResult> {
    const script = `
        tell application "Messages"
            set unreadCount to 0
            repeat with aChat in chats
                if unread count of aChat > 0 then
                    set unreadCount to unreadCount + (unread count of aChat)
                end if
            end repeat
            return unreadCount
        end tell
    `;

    return runAppleScript(script);
}

/**
 * Delete a conversation by finding and selecting it, then using UI scripting
 * to delete via the File menu.
 *
 * IMPORTANT: This uses UI scripting and requires:
 * - Accessibility permissions in System Settings > Privacy & Security > Accessibility
 * - Messages.app will be brought to foreground during deletion
 *
 * @param sender - Phone number or email to find and delete conversation for
 * @returns Result of the delete operation
 */
export async function deleteConversationBySender(
    sender: string
): Promise<AppleScriptResult> {
    // Use the batch function with a single sender
    return deleteConversationsBySenders([sender]);
}

/**
 * Delete conversations matching any of the provided senders using a hybrid approach
 *
 * This function uses a two-phase approach for reliable deletion:
 *
 * **Phase 1 (Fast):** Uses the direct Messages API to find matching handles
 * by iterating through `every chat` and checking `participants`.
 *
 * **Phase 2 (Reliable):** Uses UI scripting via System Events to delete
 * conversations by clicking the "Delete Conversation..." menu item.
 *
 * ## Phone Number Matching
 * Phone numbers are matched using the last 7 digits to handle different
 * formatting (+1, country codes, dashes, etc.). Numbers with fewer than
 * 7 digits are not matched as phone numbers to avoid false positives.
 *
 * ## Requirements
 * - **Accessibility permissions:** System Settings > Privacy & Security > Accessibility
 * - Messages.app will be activated and brought to foreground
 * - Script quits and relaunches Messages to reset to first conversation
 *
 * ## Early Exit
 * The script exits early once all target conversations have been deleted,
 * rather than scanning remaining conversations unnecessarily.
 *
 * @param {string[]} senders - Array of phone numbers or emails to match and delete
 * @param {boolean} [dryRun=false] - If true, only report matches without deleting
 * @returns {Promise<AppleScriptResult>} Result with count of deleted conversations
 *
 * @example
 * // Delete spam conversations
 * const result = await deleteConversationsBySenders([
 *     "+19179471479",
 *     "8552398509"
 * ]);
 * console.log(result.output); // "Deleted 2 conversation(s)"
 *
 * @example
 * // Dry run to preview what would be deleted
 * const result = await deleteConversationsBySenders(senders, true);
 * console.log(result.output); // "DRY RUN: Would delete 2 conversations..."
 */
export async function deleteConversationsBySenders(
    senders: string[],
    dryRun: boolean = false
): Promise<AppleScriptResult> {
    // Normalize senders: extract last 7 digits for phone numbers, lowercase emails
    const normalizedSenders = senders.map((s) => {
        const digits = s.replace(/\D/g, "");
        if (digits.length >= 7) {
            // Use last 7 digits for matching phone numbers
            return digits.slice(-7);
        }
        // Treat as email/name - lowercase it
        return s.toLowerCase().replace(/[^a-z0-9@.]/g, "");
    });

    // Build the AppleScript sender list
    const senderListStr = normalizedSenders.map((s) => `"${escapeForAppleScript(s)}"`).join(", ");

    // HYBRID APPROACH:
    // Phase 1: Use direct Messages API to find matching handles (fast)
    // Phase 2: Use UI scripting to delete via menu (reliable)
    const script = `
        -- ============================================================
        -- INITIALIZATION
        -- ============================================================
        set sender_list to {${senderListStr}}
        set handles_to_kill to {}
        set matched_info to {}
        set is_dry_run to ${dryRun ? "true" : "false"}

        -- ============================================================
        -- PHASE 1: DISCOVERY (Fast)
        -- ============================================================
        tell application "Messages"
            set all_chats to every chat

            repeat with each_chat in all_chats
                try
                    set the_participants to participants of each_chat

                    repeat with one_participant in the_participants
                        try
                            set the_handle to handle of one_participant

                            set handle_digits to ""
                            repeat with c in the_handle
                                if c is in "0123456789" then
                                    set handle_digits to handle_digits & c
                                end if
                            end repeat

                            if (count of handle_digits) > 7 then
                                set handle_last7 to text -7 thru -1 of handle_digits
                            else
                                set handle_last7 to handle_digits
                            end if

                            if (count of handle_digits) >= 7 then
                                repeat with target_sender in sender_list
                                    if handle_last7 = target_sender or handle_last7 contains target_sender or target_sender contains handle_last7 then
                                        if handles_to_kill does not contain handle_last7 then
                                            set end of handles_to_kill to handle_last7
                                            set end of matched_info to the_handle
                                        end if
                                        exit repeat
                                    end if
                                end repeat
                            end if

                        end try
                    end repeat
                end try
            end repeat
        end tell

        -- ============================================================
        -- EARLY EXIT: No matches found
        -- ============================================================
        if (count of handles_to_kill) = 0 then
            return "No matching conversations found"
        end if

        -- ============================================================
        -- DRY RUN: Report what would be deleted without deleting
        -- ============================================================
        if is_dry_run then
            return "DRY RUN: Would delete " & (count of handles_to_kill) & " conversations: " & (matched_info as string)
        end if

        -- ============================================================
        -- PHASE 2: DELETION (Reliable)
        -- ============================================================
        tell application "Messages" to quit
        delay 1
        tell application "Messages" to activate
        delay 1.5

        set deleted_count to 0
        set chat_count to 0
        set targets_to_delete to count of handles_to_kill

        tell application "Messages"
            set chat_count to count of chats
        end tell

        tell application "System Events"
            tell process "Messages"
                set frontmost to true
                delay 0.5

                repeat chat_count times
                    if deleted_count >= targets_to_delete then
                        exit repeat
                    end if

                    try
                        set the_title to name of window 1

                        set title_digits to ""
                        repeat with c in the_title
                            if c is in "0123456789" then
                                set title_digits to title_digits & c
                            end if
                        end repeat

                        if (count of title_digits) > 7 then
                            set title_last7 to text -7 thru -1 of title_digits
                        else
                            set title_last7 to title_digits
                        end if

                        set should_delete to false
                        repeat with kill_handle in handles_to_kill
                            if title_last7 contains kill_handle or kill_handle contains title_last7 then
                                set should_delete to true
                                exit repeat
                            end if
                        end repeat

                        if should_delete then
                            click menu item "Delete Conversation…" of menu "Conversation" of menu bar 1
                            delay 0.5
                            click button "Delete" of sheet 1 of window 1
                            delay 0.3
                            set deleted_count to deleted_count + 1
                        else
                            click menu item "Go to Next Conversation" of menu "Window" of menu bar 1
                            delay 0.2
                        end if

                    on error
                        try
                            click menu item "Go to Next Conversation" of menu "Window" of menu bar 1
                            delay 0.2
                        end try
                    end try
                end repeat

            end tell
        end tell

        return "Deleted " & deleted_count & " conversation(s)"
    `;

    return runAppleScript(script);
}

/**
 * Delete the currently selected conversation using UI scripting.
 * Assumes a conversation is already selected in Messages.app.
 *
 * @returns Result of the delete operation
 */
export async function deleteCurrentConversation(): Promise<AppleScriptResult> {
    const script = `
        tell application "Messages"
            activate
        end tell
        delay 0.3

        tell application "System Events"
            tell process "Messages"
                set frontmost to true
                delay 0.2

                click menu item "Delete Conversation…" of menu "File" of menu bar 1
                delay 0.3

                try
                    click button "Delete" of sheet 1 of window 1
                    delay 0.2
                on error
                    try
                        click button "Delete" of front window
                        delay 0.2
                    end try
                end try

                try
                    if exists button "Report Junk" of sheet 1 of window 1 then
                        click button "Report Junk" of sheet 1 of window 1
                        delay 0.2
                    end if
                end try
            end tell
        end tell

        return "Deleted current conversation"
    `;

    return runAppleScript(script);
}

/**
 * Quit Messages.app
 */
export async function quitMessages(): Promise<AppleScriptResult> {
    const script = `
        tell application "Messages"
            quit
        end tell
    `;

    return runAppleScript(script);
}

/**
 * Launch Messages.app
 */
export async function launchMessages(): Promise<AppleScriptResult> {
    const script = `
        tell application "Messages"
            activate
        end tell
    `;

    return runAppleScript(script);
}
