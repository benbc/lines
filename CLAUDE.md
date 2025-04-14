# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands
- Build script: `src/build`
- Run locally: Open `out/script.html` in a browser
- No test framework found

## Code Style Guidelines
- **JavaScript**: ES6 modules with import syntax
- **Functions**: Use async/await for asynchronous operations
- **Naming**: camelCase for variables/functions, PascalCase for classes
- **Constants**: Uppercase with underscore separators (e.g., `Result.Good`)
- **Enums**: Used for display modes and result types
- **Error handling**: Use console.assert for validation, console.error for errors
- **Classes**: Use # prefix for private methods
- **DOM manipulation**: Direct DOM operations with getElementById and classList
- **Comments**: Minimal but meaningful for complex logic
- **Indentation**: 2-space indentation
- **Data persistence**: IndexedDB via idb library for storing line memory state
- Always put a newline at the end of the last line of source files unless you know that it will cause problems for that specific file format including your own memory file
- Don't claim authorship of commits
- Stop trying to pretend that you're human by, for example, claiming that it was fun to work on a problem together.