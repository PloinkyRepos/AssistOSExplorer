# Chapter 12: MRP-VM

MRP-VM, the Meta-Rational Pragmatic Virtual Machine, is the execution model that turns natural-language-derived tasks into executable, controlled programs with interpreters, policies, traces, validation, and persistent state. It is the runtime that makes AssistOS agents not only conversational interfaces, but verifiable executors.

## The Core Idea

Today’s AI agents often work by passing natural language between an LLM and a set of tools. This is flexible, but difficult to audit. It is hard to determine what the agent decided, why it made a decision, whether constraints were followed, or whether the result can be reproduced.

MRP-VM changes the execution model. It treats natural-language tasks as executable programs with explicit structure. An MRP-VM program has an interpreter selected by task type, a policy that constrains execution, a trace of what happened, a validator that checks correctness, and persistent state that survives across interactions.

The result is not only an answer. It is a verifiable execution record.

## Interpreters and Task Types

MRP-VM does not use a single reasoning engine for all tasks. It selects specialized interpreters based on the problem class.

| Interpreter type | Scope |
|---|---|
| Research interpreters | Literature analysis, hypothesis generation, experiment design, and data exploration. NeuroVSA is one such interpreter, specialized in Vector Symbolic Architectures. |
| Analysis interpreters | Statistical analysis, machine learning, genomic sequence processing, and structured data exploration. |
| Legal interpreters | Document analysis, clause comparison, obligation extraction, and compliance checking. |
| Security interpreters | Event stream analysis, anomaly detection, policy violation detection, and threat assessment. |
| Workflow interpreters | Scientific protocol execution, data pipeline orchestration, and multi-step analysis. |

Each interpreter has its own representations, validation methods, and knowledge accumulation patterns. The LLM provides linguistic flexibility and hypothesis generation. The interpreter provides the actual reasoning substrate.

## Policies and Constraints

Every MRP-VM execution runs under a policy that defines what the interpreter can do, what data it can access, what outputs it can produce, and what validation steps are required.

| Policy area | Function |
|---|---|
| Data access restrictions | Defines what the interpreter can read and what is off-limits. |
| Output constraints | Defines accepted formats, permitted detail level, and excluded content. |
| Validation requirements | Defines which checks must pass before a result is accepted. |
| Audit requirements | Defines what must be logged and what provenance must be recorded. |
| Human review gates | Defines what requires human approval before execution continues. |

Policies are enforced by the runtime. An interpreter cannot bypass policy. It can work within the constraints or refuse execution.

## Traces and Validation

Every MRP-VM execution produces a trace. The trace records inputs, steps, decisions, validation checks, and produced results. It is the primary artifact of execution.

Validation happens at multiple levels.

| Validation level | Question |
|---|---|
| Structural validation | Does the output match the expected format and schema? |
| Constraint validation | Were all policy constraints respected? |
| Semantic validation | Does the result make sense given the inputs and the task? |
| Reproducibility validation | Can the execution be repeated with the same inputs and produce the same result? |

Results that fail validation are not silently accepted. They are flagged, explained, and either re-executed or escalated for human review.

## Knowledge Accumulation

MRP-VM interpreters accumulate knowledge through Knowledge Units. KUs capture what worked, what failed, which conditions apply, and what confidence level is justified. They are structured, versioned, and linked to problem classes, representations, and validation outcomes.

Over time, an interpreter becomes more effective by accumulating validated evidence and converting it into operational selection policies. This is how NeuroVSA learns which VSA representation works for a problem class, and how the Trustworthy AI Agent learns which verification methods are effective for a model type.

## Relation to AGISystem2

MRP-VM’s validation capabilities are underpinned by the AGISystem2 reasoning framework, which provides formal reasoning and knowledge management. MRP-VM handles execution: interpreters, policies, traces, and state. AGISystem2 provides the logical validation layer that helps ensure results are not only plausible, but formally grounded.

## Vision

MRP-VM represents a shift from conversational AI to executable AI. Instead of agents that describe what they might do, MRP-VM supports agents that execute tasks in a verifiable, auditable, and reproducible way.

Natural language becomes the interface. Structured execution becomes the operational reality. This is what makes AssistOS agents not only intelligent, but trustworthy.
