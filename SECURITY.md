# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.5.x   | :white_check_mark: |
| 2.4.x   | :x:                |
| < 2.4   | :x:                |

## Reporting a Vulnerability

The NexusFlow team takes the security of our application and its users seriously. If you believe you have found a security vulnerability in NexusFlow, please report it to us responsibly.

### How to Report

Please **do not** report security vulnerabilities through public GitHub issues.

Instead, please report security issues through one of the following methods:
1. **GitHub Security Advisory:** Submit a private vulnerability report via the [NexusFlow Security Advisories](https://github.com/antan87/NexusFlow/security/advisories/new) page.
2. **Email:** Send details to the project maintainers at `patronant@gmail.com` with the subject line `[SECURITY] NexusFlow Vulnerability Report`.

Please include:
- A description of the issue and its potential impact.
- Step-by-step instructions or proof-of-concept code to reproduce the issue.
- Any suggested remediations or patches if available.

### Response Timeline

- **Initial Response:** Within 48 hours of receiving the report.
- **Status Updates:** Regular updates during investigation and fix development.
- **Public Disclosure:** Coordinated disclosure after a fix has been released across all supported channels (npm, GitHub releases, VS Code extension).

## Security Architecture & Threat Model

NexusFlow implements multiple layers of defense-in-depth:
- **Localhost Containment:** Background HTTP/WebSocket daemon explicitly binds to `127.0.0.1` and enforces strict `Host` header and `Origin` validation to protect against DNS-rebinding attacks.
- **Path Isolation & Containment:** Workspace creation, repository additions, and WebSocket session paths are strictly contained within authorized workspace directories.
- **Release Verification:** Update installers are cryptographically verified against SHA-256 hashes before execution.
- **Subprocess Isolation:** AI agent sessions and PM2 services run under strict, dedicated process namespaces with isolated working directories.
