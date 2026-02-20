# SMS Spam Killer Architecture

This document provides a detailed technical overview of the SMS Spam Killer architecture, including the TagRouter Engine and the SMS domain implementation.

## Table of Contents

- [System Overview](#system-overview)
- [Core Concepts](#core-concepts)
- [TagRouter Engine](#tagrouter-engine)
- [Processing Pipeline](#processing-pipeline)
- [Plugin System](#plugin-system)
- [Domain Implementation](#domain-implementation)
- [Event System](#event-system)
- [Extension Points](#extension-points)

---

## System Overview

SMS Spam Killer is built on a two-layer architecture:

1. **TagRouter Engine** (`@tagrouter/engine`): A domain-agnostic classification and orchestration framework
2. **SMS Domain Implementation**: The concrete implementation for SMS/iMessage filtering

### High-Level Architecture

```mermaid
---
config:
  theme: redux
  themeVariables:
    primaryColor: '#e1f5fe'
    primaryBorderColor: '#0288d1'
    secondaryColor: '#fff3e0'
    tertiaryColor: '#f3e5f5'
  look: classic
---
flowchart TB
  %% ───────────────────────────────
  %% SMS SPAM KILLER APPLICATION
  %% ───────────────────────────────
  subgraph App["SMS Spam Killer Application"]
    direction TB
    Provider["Provider<br>(Polls Messages DB every 30s)"]
    Classifiers["Classifiers<br>(Rules + AI)"]
    Actions["Actions<br>(Delete / Notify)"]
    UserPlugins["User Plugins<br>(Custom extensions)"]
  end

  %% ───────────────────────────────
  %% TAGROUTER ENGINE (IOC CORE)
  %% ───────────────────────────────
  subgraph Engine["@tagrouter/engine"]
    direction TB
    Contracts["Contracts<br>(Interfaces)"]
    Core["TagRouterEngine<br>(Orchestrator / IoC host)"]
    PluginLoader["PluginLoader<br>(Loads app classifiers & actions)"]
    EventBus["EventBus<br>(Observability / Tracing)"]
  end

  %% ───────────────────────────────
  %% MACOS PLATFORM
  %% ───────────────────────────────
  subgraph Platform["macOS Platform"]
    direction TB
    MessagesDB["~/Library/Messages/chat.db"]
    MessagesApp["Messages.app<br>(AppleScript)"]
    Notifications["Notification Center"]
  end

  %% ───────────────────────────────
  %% DATA + CONTROL FLOWS
  %% ───────────────────────────────

  %% Pulling messages from platform
  Provider -.->|polls every 30s| MessagesDB

  %% Using engine via inversion of control
  Provider --> Core
  Classifiers --> Core
  Actions --> Core
  UserPlugins --> PluginLoader
  Contracts -.-> Core

  %% Internals within engine
  Core --> EventBus
  PluginLoader --> Core

  %% Results back to macOS
  Actions --> MessagesApp
  Actions --> Notifications

  %% An IoC relationship label
  App -.->|Inversion of Control:<br>App provides plugins & actions| Engine
```

---

## Core Concepts

### Inversion of Control (IoC)

The TagRouter Engine implements IoC - the framework calls your code, not the other way around:

```mermaid
flowchart LR
    subgraph Traditional["Traditional Approach"]
        App1["Your App"] --> Lib["Library"]
    end

    subgraph IoC["IoC (TagRouter)"]
        Engine["TagRouter Engine"] --> Domain["Your Domain Code"]
    end
```

**Benefits:**
- Engine is reusable across domains (SMS, email, social media)
- Domain code focuses purely on business logic
- Consistent execution lifecycle across all domains

### Contract-Based Design

All components implement well-defined contracts (interfaces):

```mermaid
classDiagram
    class Entity {
        <<interface>>
        +string id
        +string content
        +object metadata
        +string? traceId
    }

    class ClassificationPlugin {
        <<interface>>
        +string id
        +string? name
        +classify(Entity, Context) ClassificationOutput?
    }

    class ActionPlugin {
        <<interface>>
        +string id
        +Record bindings
        +handle(ActionContext) ActionResult
    }

    class EntityProvider {
        <<interface>>
        +string id
        +string name
        +initialize()
        +getEntities(FetchOptions) FetchResult
        +shutdown()
    }

    SMSMessage ..|> Entity : implements
    SMSClassifier ..|> ClassificationPlugin : implements
    DeleteAction ..|> ActionPlugin : implements
    iMessageProvider ..|> EntityProvider : implements
```

---

## TagRouter Engine

### Engine Responsibilities

The TagRouter Engine handles:

1. **Lifecycle Management**: Start, stop, graceful shutdown
2. **Entity Polling**: Pull entities from providers at configurable intervals
3. **Classification Pipeline**: Run all classifiers, resolve conflicts by confidence
4. **Action Dispatch**: Execute actions based on classification results
5. **Event Emission**: Notify subscribers at each processing stage

### Engine Internals

```mermaid
flowchart TB
    subgraph Engine["TagRouterEngine"]
        Start["start()"]
        Poll["Polling Loop<br/>(30s default)"]
        Process["processEntity()"]
        Classify["runClassifiers()"]
        Resolve["resolveClassification()"]
        Dispatch["dispatchActions()"]
        Stop["stop()"]
    end

    Start --> Poll
    Poll --> |"fetch entities"| Process
    Process --> Classify
    Classify --> |"all results"| Resolve
    Resolve --> |"highest confidence"| Dispatch
    Dispatch --> Poll

    Stop --> |"graceful"| Poll
```

### Domain Registration

Domains register themselves with the engine:

```typescript
const engine = new TagRouterEngine({
    pollingInterval : 30000,
    batchSize       : 10,
});

engine.registerDomain({
    id          : "sms",
    name        : "SMS Spam Killer",
    provider    : iMessageProvider,
    classifiers : [systemRules, aiClassifier, ...userPlugins],
    actions     : [deleteAction, notifyAction],
    config      : { dryRun: true },
});

await engine.start();
```

---

## Processing Pipeline

### Complete Message Flow

```mermaid
sequenceDiagram
    participant P as Provider
    participant E as Engine
    participant C1 as System Rules
    participant C2 as AI Classifier
    participant C3 as User Plugins
    participant A as Actions
    participant Bus as EventBus

    E->>P: getEntities({ limit: 10 })
    P-->>E: [message1, message2, ...]

    loop For each message
        E->>Bus: emit(message:received)

        par Run all classifiers
            E->>C1: classify(message)
            C1-->>E: { type: "spam", confidence: 0.9 }
            E->>C2: classify(message)
            C2-->>E: { type: "marketing", confidence: 0.7 }
            E->>C3: classify(message)
            C3-->>E: null
        end

        E->>E: Select highest confidence
        E->>Bus: emit(message:classified)

        E->>A: handle(context) for matching bindings
        A-->>E: { success: true }
        E->>Bus: emit(message:actionExecuted)

        E->>Bus: emit(message:processed)
    end
```

### Confidence Resolution

When multiple classifiers return results, the highest confidence wins:

```mermaid
flowchart LR
    subgraph Results["Classification Results"]
        R1["System Rules<br/>spam: 0.9"]
        R2["AI Classifier<br/>marketing: 0.7"]
        R3["User Plugin<br/>null"]
    end

    Results --> Resolve["Resolve<br/>(max confidence)"]
    Resolve --> Winner["Winner:<br/>spam (0.9)"]
    Winner --> Actions["Execute Actions<br/>bound to 'spam'"]
```

**Confidence Guidelines:**
| Confidence | Meaning | Example |
|------------|---------|---------|
| 1.0 | Hard rule match | Exact regex match |
| 0.9-0.99 | High confidence rule | Pattern + context |
| 0.5-0.89 | Probabilistic | AI classification |
| <0.5 | Weak heuristic | Partial matches |

---

## Plugin System

### Plugin Loading Order

Plugins are loaded and executed in a specific order:

```mermaid
flowchart TB
    subgraph Loading["Plugin Loading Order"]
        S["1. System Plugins<br/>(plugins/system/*.yml)"]
        A["2. AI Classifier<br/>(OpenAI)"]
        U["3. User Plugins<br/>(user/plugins/*)"]
    end

    subgraph Execution["Execution (Concurrent)"]
        All["All classifiers run<br/>in parallel"]
    end

    S --> All
    A --> All
    U --> All

    All --> Best["Highest confidence<br/>wins"]
```

### YAML Plugin Format

Simple rules can be defined in YAML:

```yaml
- name: crypto-spam
  description: Cryptocurrency investment scams
  match:
    regex: "\\b(bitcoin|crypto).*(invest|profit)"
    sender: "^\\d{5,6}$"  # Optional: sender pattern
    contains: "guaranteed"  # Optional: substring match
  type: spam
  confidence: 0.95
  tags:
    - crypto
    - investment
```

### TypeScript Plugin Format

Complex logic requires TypeScript:

```typescript
export const myClassifier: ClassificationPlugin = {
    id          : "my-classifier",
    name        : "My Classifier",
    description : "Custom classification logic",

    classify(message: Entity, context: ClassificationContext) {
        const { logger, config } = context;

        // Access message content and metadata
        const content = message.content;
        const sender  = message.metadata?.sender;

        // Your classification logic
        if (someCondition) {
            return {
                type       : "spam",
                confidence : 0.85,
                tags       : ["custom-rule"],
            };
        }

        // Return null to defer to other classifiers
        return null;
    },
};
```

### Action Plugin Format

Actions declare which message types they handle:

```typescript
export const deleteAction: ActionPlugin = {
    id: "delete-spam",

    // Declarative bindings: type -> confidence threshold
    bindings: {
        spam : { minConfidence: 0.9 },
        scam : { minConfidence: 0.9 },
    },

    async handle(context: ActionContext): Promise<ActionResult> {
        const { message, classification, logger } = context;

        // Perform the action
        await deleteConversation(message.metadata.sender);

        return {
            actionId : this.id,
            success  : true,
        };
    },
};
```

---

## Domain Implementation

### SMS Entity

The SMS domain extends the base Entity:

```mermaid
classDiagram
    class Entity~TMetadata~ {
        <<interface>>
        +string id
        +string content
        +TMetadata metadata
        +string? traceId
    }

    class SMSMessageMetadata {
        +string sender
        +Date timestamp
        +boolean isFromMe
        +boolean isRead
        +string service
        +string? chatId
        +string guid
    }

    class SMSMessage {
        +type = "sms-message"
    }

    Entity <|-- SMSMessage : extends
    SMSMessage --> SMSMessageMetadata : uses
```

### iMessage Provider

The provider reads from the macOS Messages database:

```mermaid
flowchart LR
    subgraph Provider["iMessageEntityProvider"]
        Init["initialize()<br/>Open SQLite"]
        Fetch["getEntities()<br/>Query new messages"]
        Convert["Convert rows<br/>to SMSMessage"]
        Track["Track cursor<br/>(lastMessageId)"]
        Shutdown["shutdown()<br/>Close connection"]
    end

    subgraph Platform["macOS"]
        DB["~/Library/Messages/chat.db"]
    end

    DB --> Fetch
    Init --> Fetch
    Fetch --> Convert
    Convert --> Track
    Track --> Fetch
```

### Actions

```mermaid
flowchart TB
    Classification["Classification Result<br/>type: spam, confidence: 0.95"]

    subgraph Actions["Registered Actions"]
        Delete["DeleteAction<br/>bindings: spam@0.9, scam@0.9"]
        Notify["NotifyAction<br/>bindings: spam@0.7, suspicious@0.8"]
    end

    Classification --> Delete
    Classification --> Notify

    Delete --> |"AppleScript"| MessagesApp["Messages.app<br/>Delete Conversation"]
    Notify --> |"osascript"| NotifCenter["Notification Center"]
```

---

## Event System

### Event Types

The engine emits events at each lifecycle stage:

```mermaid
stateDiagram-v2
    [*] --> Starting: engine:starting
    Starting --> Started: engine:started

    state Started {
        [*] --> Polling
        Polling --> Received: message:received
        Received --> Classifying: message:classifying
        Classifying --> Classified: message:classified
        Classifying --> Unclassified: message:unclassified
        Classified --> ActionExecuting: message:actionExecuting
        ActionExecuting --> ActionExecuted: message:actionExecuted
        ActionExecuting --> ActionError: message:actionError
        ActionExecuted --> Processed: message:processed
        ActionError --> Processed
        Unclassified --> Processed
        Processed --> Polling
    }

    Started --> Stopping: engine:stopping
    Stopping --> Stopped: engine:stopped
    Started --> Error: engine:error
```

### Event Subscription

```typescript
// Subscribe to all events
engine.eventBus.subscribe("*", (event) => {
    console.log(`[${event.type}]`, event.data);
});

// Subscribe to specific events
engine.eventBus.subscribe("message:classified", (event) => {
    const { messageId, classification } = event.data;
    console.log(`Classified ${messageId} as ${classification.type}`);
});

// One-time subscription
engine.eventBus.once("engine:started", () => {
    console.log("Engine is ready!");
});
```

### Event Payload

```typescript
interface EventPayload {
    readonly type      : string;       // Event type
    readonly timestamp : string;       // ISO timestamp
    readonly traceId?  : string;       // For correlation
    readonly data?     : Record<string, unknown>;
}
```

---

## Extension Points

### Adding a New Classifier

1. Create a TypeScript file in `user/plugins/`:

```typescript
// user/plugins/my-classifier.ts
import type { ClassificationPlugin } from "@tagrouter/engine";

export const myClassifier: ClassificationPlugin = {
    id: "my-classifier",
    classify(message, context) {
        // Your logic
        return { type: "custom-type", confidence: 0.9 };
    },
};

export default myClassifier;
```

2. Rebuild and restart:

```bash
npm run build
npm start
```

### Adding a New Action

1. Create an action plugin:

```typescript
// user/plugins/my-action.ts
import type { ActionPlugin } from "@tagrouter/engine";

export const myAction: ActionPlugin = {
    id: "my-action",
    bindings: {
        "custom-type": { minConfidence: 0.8 },
    },
    async handle(context) {
        // Your action logic
        return { actionId: this.id, success: true };
    },
};
```

### Adding a New Domain

The engine is domain-agnostic. To add a new domain (e.g., email):

```typescript
// 1. Define your entity
interface EmailMessage extends Entity<EmailMetadata> {
    type: "email-message";
}

// 2. Create a provider
const emailProvider: EntityProvider<EmailMessage> = {
    id: "gmail-provider",
    name: "Gmail Provider",
    async getEntities(options) {
        // Fetch emails from Gmail API
        return { entities, cursor, hasMore: false };
    },
};

// 3. Create classifiers and actions
// ...

// 4. Register with the engine
engine.registerDomain({
    id          : "email",
    name        : "Email Spam Killer",
    provider    : emailProvider,
    classifiers : [emailClassifier],
    actions     : [emailActions],
});
```

---

## Summary

The SMS Spam Killer architecture emphasizes:

| Principle | Implementation |
|-----------|----------------|
| **IoC** | Engine orchestrates; domains supply logic |
| **Contracts** | Clean interfaces for all components |
| **Plugins** | YAML for rules, TypeScript for logic |
| **Concurrency** | All classifiers run in parallel |
| **Determinism** | Highest confidence wins, consistent order |
| **Observability** | Events at every stage, trace IDs |
| **Extensibility** | User plugins, new domains, custom actions |

For the design philosophy behind these decisions, see:
- [docs/tagrouter-complete-updated-design.md](docs/tagrouter-complete-updated-design.md)
- [docs/tagrouter-high-level-design.md](docs/tagrouter-high-level-design.md)
