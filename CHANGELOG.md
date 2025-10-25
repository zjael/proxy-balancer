# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2025-10-25

### 🎉 Major Rewrite - TypeScript & Modern Architecture

This is a complete rewrite of proxy-balancer in TypeScript with significant breaking changes.

### Added

- ✨ **Full TypeScript support** - Complete type safety with strict mode
- 📦 **Dual package** - ESM and CommonJS support via exports field
- 🏗️ **Modular architecture** - Split into focused modules (core, utils, errors, types)
- 🎯 **Type exports** - All types exported for TypeScript users
- 📚 **Comprehensive documentation** - Updated README with TypeScript examples
- 🔄 **Migration guide** - MIGRATION.md for upgrading from v2
- ⚡ **Vitest** - Modern, faster test framework replacing Mocha/Chai
- 🎨 **ESLint + Prettier** - Code quality and formatting tools
- 🚀 **tsup build system** - Optimized builds with source maps
- 🔍 **Strict type checking** - Catch errors at compile time
- 🌐 **Multi-OS CI** - Testing on Ubuntu, Windows, and macOS
- 📊 **Coverage reporting** - Built-in with Vitest

### Changed

- 💥 **BREAKING:** Minimum Node.js version is now 18+ (was 10+)
- 💥 **BREAKING:** Package is now ESM-first with CJS compatibility
- 💥 **BREAKING:** Import syntax changed:
  ```typescript
  // Before (v2.x)
  const Balancer = require('proxy-balancer');

  // After (v3.x)
  import { Balancer } from 'proxy-balancer';
  // or CommonJS
  const { Balancer } = require('proxy-balancer');
  ```
- 💥 **BREAKING:** No default export, only named exports
- 📦 Main entry point changed from `./lib/balancer.js` to `./dist/index.js` (ESM) and `./dist/index.cjs` (CommonJS)
- 🏗️ Codebase split into modular structure instead of monolithic file
- 🧪 Test framework changed from Mocha/Chai to Vitest
- 📝 Updated all documentation with TypeScript examples

### Removed

- 💥 **BREAKING:** Removed `shuffle-array` dependency (replaced with native Fisher-Yates implementation)
- 💥 **BREAKING:** Removed `url` package dependency (replaced with native URL)
- 🗑️ Removed old lib/ directory
- 🗑️ Removed Mocha, Chai, Sinon (replaced with Vitest)

### Fixed

- 🐛 Fixed rate limiter race condition in tests
- 🐛 Fixed optional dependencies issues on macOS and Windows in CI
- 🔧 Improved cross-platform compatibility
- ⚡ Better async state handling with setImmediate

### Internal

- 📦 Build output now in `dist/` instead of `lib/`
- 🔨 Added TypeScript compilation step
- 🧹 Cleaner package structure with proper exports
- 📊 CI now tests on Node.js 18.x, 20.x, 22.x (was 11.x, 12.x)
- 🎯 Single fork test execution for better reliability
- 📝 Added comprehensive type definitions

### Migration Guide

See [MIGRATION.md](./MIGRATION.md) for detailed upgrade instructions.

**Key Steps:**
1. Update Node.js to 18+
2. Change import syntax to named imports
3. Update TypeScript if using
4. Test thoroughly - API is mostly compatible but with type improvements

### Upgrade Notes

While this is a major version with breaking changes, the **runtime API is mostly backward compatible**. The main changes are:
- Module system (ESM/CJS)
- Import syntax
- Node.js version requirement
- Build output location

The actual Balancer configuration and methods remain the same.

---

## [2.0.1] - Previous Release

See git history for v2.x changelog.

[3.0.0]: https://github.com/zjael/proxy-balancer/compare/2.0.1...3.0.0
