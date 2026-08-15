---
name: audit-review
description: Audit the quality, correctness, and completeness of a pull-request review. Use when the user asks for a review audit, or when a model is delegating a pull-request review to a subagent and needs the review audited.
---

# Audit Review

## Purpose

<!-- Define the purpose and boundaries of this skill. -->

## Invocation

### User-requested audit

<!-- Describe the expected behavior when the user requests an audit. -->

### Subagent review audit

<!-- Describe the expected behavior when auditing another model's review. -->

## Inputs

<!-- Define the required and optional context. -->

- Pull request or change set: <!-- ... -->
- Review under audit: <!-- ... -->
- Repository guidance and relevant files: <!-- ... -->
- User or project requirements: <!-- ... -->

## Workflow

1. <!-- Gather and verify the available context. -->
2. <!-- Evaluate the review against the change and requirements. -->
3. <!-- Check each finding for evidence, severity, and actionability. -->
4. <!-- Identify omissions, false positives, and unsupported claims. -->
5. <!-- Produce the required audit output. -->

## Audit criteria

### Correctness

<!-- Define how correctness is assessed. -->

### Completeness

<!-- Define what a complete review must cover. -->

### Severity and prioritization

<!-- Define severity levels and how to prioritize findings. -->

### Evidence standard

<!-- Define what evidence is required before reporting a finding. -->

## Output format

<!-- Define the exact response structure. -->

```md
## Verdict
<!-- ... -->

## Findings
<!-- Define the required fields for each finding. -->

## Gaps
<!-- ... -->

## Notes
<!-- ... -->
```

## Constraints

<!-- Define exclusions, confidence requirements, and escalation rules. -->

## Validation

<!-- Define how the audit should be checked before returning it. -->
