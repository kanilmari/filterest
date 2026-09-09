<!-- Defines the enduring product principles of Filterest. -->
<!-- Connects application behavior, architecture, data handling and documentation. -->
<!-- Exists to keep the product coherent, maintainable and dependable as it evolves. -->

# The Constitution of Filterest

This is the constitution for Filterest. It defines durable product principles. Technical guides, design guidance and contribution instructions explain how to apply them. Maintain these principles here once and link to them elsewhere.

## 1. Build a dependable, understandable product

Prefer clarity, maintainability and useful capability. Avoid multiple sources of truth and unnecessary moving parts. Centralize complexity when doing so makes the rest of the system simpler.

Design complete features with predictable behavior, clear language and consistent interaction. Preserve supported languages, accessibility, and the application's explicit light and dark themes. Keep detailed visual rules in the design guide and reusable code patterns in the reference implementations.

## 2. Keep one authoritative source and manage the whole data lifecycle

Maintain one authoritative implementation for each capability and one authoritative definition for each setting. Store mutable user and administrator behavior in validated, permission-checked runtime configuration with stable identities. Keep immutable protocols, migrations and safe bootstrap defaults in source.

Before implementing a capability, decide how it is configured, migrated, disabled, restored, replaced and removed, including old data and fallback behavior. Application data changes use supported APIs; schema changes use versioned migrations. Backups and recovery must preserve the data and permissions needed to restore a working installation. Verify the new state before retiring an obsolete one.

Keep credentials and machine-specific configuration separate from application source. Protect personal data and enforce access permissions throughout the data lifecycle.

## 3. Make changes traceable and verify the actual result

Make meaningful changes traceable to the problem they solve. Record decisions that future maintenance depends on, and keep the relevant documentation aligned with the implementation.

Match verification to the changed behavior and its real risk. Test security and data boundaries, verify behavior in the intended running application, and distinguish observed results from assumptions. Do not claim completion or compatibility without evidence.

## 4. Keep documentation and releases truthful

Give each lasting rule or topic one canonical home. Explain purpose and constraints in documentation and refer to the source that owns changing values. Update the relevant guide when behavior changes.

Code should explain its purpose, important connections and non-obvious constraints. Keep detailed comment conventions in the development guide and avoid repetitive comments for trivial code.

Releases must identify their version, database compatibility, upgrade requirements and applicable license. Include the intended application files and properly attributed assets. Credentials, personal data and installation-specific backups must never enter public release packages.

If a rule creates work without protecting the product, explain the concrete problem and propose a simpler replacement. Keep the rule and its implementation consistent.
