/**
 * @fileoverview iMessage services barrel exports
 *
 * @module adapters/imessage/services
 */

export {
    ChatDatabase,
    type IMessage,
    type MessageRow,
    type HandleRow,
    type Conversation,
    type FetchMessagesOptions,
} from "./chat-db.js";

export {
    runAppleScript,
    sendMessage,
    sendToChat,
    openChat,
    isMessagesRunning,
    activateMessages,
    speakText,
    copyToClipboard,
    getUnreadCount,
    deleteConversationBySender,
    deleteConversationsBySenders,
    deleteCurrentConversation,
    quitMessages,
    launchMessages,
    type AppleScriptResult,
} from "./applescript.js";
