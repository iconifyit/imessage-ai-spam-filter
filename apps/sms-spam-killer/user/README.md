# User Directory

This directory contains all user-customizable files for the SMS Spam Killer app.

**IMPORTANT**: Files in this directory are yours to modify. They will not be overwritten by app updates.

## Directory Structure

```
user/
├── settings.yml          # Main configuration file
├── plugins/              # Custom classifier and action plugins
│   └── example-classifier.ts  # Example plugin (copy and modify)
└── README.md             # This file
```

## settings.yml

The main configuration file. Edit this to customize:

- Polling interval (how often to check for messages)
- Dry run mode (test without deleting)
- Notification thresholds
- Delete action thresholds
- Custom message types

## plugins/

Place your custom plugins here. The app supports two plugin formats:

### TypeScript/JavaScript Plugins

For complex classification logic. See `example-classifier.ts` for a template.

```typescript
// my-classifier.ts
export default {
    id: "my-classifier",
    name: "My Custom Classifier",
    classify(message, context) {
        // Your logic here
        return { type: "spam", confidence: 0.9 };
    }
};
```

### YAML Plugins

For simple pattern-based rules:

```yaml
# my-patterns.yml
classifiers:
  - id: my-keyword-detector
    name: My Keyword Detector
    rules:
      - type: spam
        confidence: 0.85
        patterns:
          - contains: "free money"
          - contains: "act now"
```

## Getting Started

1. Edit `settings.yml` to configure thresholds and behavior
2. Copy `plugins/example-classifier.ts` to create your own classifier
3. Rebuild the app: `npm run build`
4. Run: `npm run start`

## Tips

- Start with `dryRun: true` in settings to test without deleting
- Use higher confidence thresholds (0.9+) for delete actions
- User plugins run after system plugins, so you can override system classifications
