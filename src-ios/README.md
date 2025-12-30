# OpenContext iOS MVP

This folder contains a React Native (Expo) iOS MVP for OpenContext.

## Run

```bash
cd src-ios
npm install
npm run ios
```

## Notes

- SQLite schema mirrors `crates/opencontext-core/src/lib.rs`.
- Documents are stored as Markdown files under the app sandbox (editor UI pending).
- Ideas are stored as Markdown files under `.ideas/`.
- Settings are stored in AsyncStorage (language only).

## AI Reflection (Ideas)

Configure via Settings > AI.
