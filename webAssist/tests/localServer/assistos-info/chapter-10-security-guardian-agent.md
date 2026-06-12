# Chapter 10: Security Guardian Agent

The Security Guardian Agent is Ploinky’s intelligent security layer for the entire workspace. It observes code, dependencies, containers, models, configurations, network activity, user behavior, and agent behavior. It functions as a guardian that scans, tests, correlates, validates, and reports.

## Vision

Ploinky workspaces can contain many agents, tools, datasets, models, plugins, secrets, and external connections. Security cannot be reduced to one scanner or one checklist. It must be continuous, contextual, and connected to the actual behavior of users and agents.

Security Guardian Agent provides this layer. It combines deterministic security checks with intelligent triage so that critical findings remain auditable while ambiguous events become easier to interpret.

## A Mixed Approach: Deterministic and Intelligent

Security Guardian Agent combines symbolic verification, explicit rules, declarative policies, signatures, deterministic scans, and baselines with LLM-assisted triage, alert explanation, context identification, and false-positive reduction.

Critical checks remain deterministic. Secret detection, dependency vulnerability matching, policy violations, license checks, exposed ports, and known insecure configurations must be inspectable and reproducible. Ambiguous cases, such as whether a sequence of actions is suspicious in context, can benefit from intelligent explanation and correlation.

The hybrid approach keeps security decisions reliable while improving analyst efficiency.

## What It Protects

The agent operates across three regimes.

| Regime | Protection scope |
|---|---|
| Development security | Scans source code for vulnerable patterns, detects secrets in repositories and files, identifies vulnerable dependencies and license issues, verifies container images and deployment configurations, and enforces secure coding policies. |
| Supply chain security | Produces and verifies SBOMs, tracks vulnerabilities across components, monitors license compliance, and links each finding to the affected artifact: repository, image, package, model, or dataset. |
| Runtime security | Monitors processes, containers, system calls, logs, network connections, and agent behavior. It detects anomalies, intrusion attempts, policy violations, and deviations from approved baselines. |

## Penetration Testing

The agent can run authorized penetration tests against workspace endpoints, APIs, plugins, and public-facing interfaces. It manages scope, testing windows, intensity, and reporting. It verifies what is actually exposed, not only what should be exposed according to configuration.

Penetration testing is always bounded by declared authorization. The agent should not run uncontrolled attacks. It should run scoped, reproducible, logged tests that produce actionable evidence.

## Policy Enforcement

Security Guardian Agent reads administrator policies and verifies compliance during execution. Policies define which agents can access the internet, which folders they can read, which tools they can call, which models they can use, what data can be exported, and what actions require approval.

The agent detects direct violations and operational deviations. For example, an agent reading a large volume of sensitive data before making an unusual external connection is not only a file-access event and not only a network event. It is a correlated behavior that requires investigation.

## Monitoring Users and Agents

In a workspace with many agents and users, both must be monitored. For users, the guardian detects unusual access patterns, abnormal volumes, suspicious authentication, risky configuration changes, and lateral movement. For agents, it monitors tool calls, file access, network connections, prompt-injection attempts, cost anomalies, and actions that deviate from the agent’s defined purpose.

This is especially important in agentic systems because an agent may become an attack surface. A prompt injection, tool misuse, leaked secret, or malicious plugin can cause behavior that looks technically valid but violates policy.

## GxP and Regulated Environments

For regulated contexts, Security Guardian Agent produces evidence for qualification, validation, change control, audit trails, and data integrity. It can support compliance with frameworks such as 21 CFR Part 11 and EU GMP Annex 11 by generating structured evidence that connects security controls to regulatory requirements.

In this context, security is not only defensive. It is also documentary. The system must prove what happened, who approved it, which controls were active, which tests were run, and what evidence supports release.

## Knowledge Accumulation

Every scan, incident, and remediation produces reusable knowledge. The agent extracts Knowledge Units about detection rules, false-positive patterns, validated remediation steps, secure baselines, incident patterns, and policy-control mappings. These accumulate and improve future scans.

Security therefore becomes a learning operational system. The workspace does not merely collect logs. It converts security experience into reusable knowledge.

## Vision

Security Guardian Agent is not a collection of separate scanners. It is a unified security intelligence layer for the workspace. It understands the relationships between code, dependencies, containers, models, users, agents, policies, and network activity.

It produces actionable findings, not just alerts. It accumulates knowledge, not just logs. It turns workspace security from a reactive practice into a proactive, continuously improving system.
