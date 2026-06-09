# Chapter 5: Ploinky Environment

Ploinky is the secure AI agent deployment and development platform that serves as the runtime foundation for the entire AssistOS ecosystem. It provides the infrastructure needed to run AI agents in isolated, reproducible environments, making it possible to develop, test, and deploy agents with confidence.

## What Is Ploinky?

In Ploinky, an agent is an abstract concept: any tool or application that can be invoked and interacted with. Agents can range from simple scripts to complex AI-powered applications. They are organized into repositories, which can contain multiple agents and can be enabled or disabled as needed.

Ploinky is open source under the MIT License and available on GitHub. This open approach ensures transparency, community contribution, and the freedom to adapt the platform to specific needs.

## Core Architecture

Ploinky's architecture is built around several key concepts.

Each agent runs in its own isolated container, using Docker or Podman, with restricted access. This ensures isolation between agents and from the host system. For lighter workloads, Ploinky can use bubblewrap on Linux or seatbelt on macOS for process-level sandboxing without full container overhead.

Agents are organized through a repository system, making it easier to manage, share, and version collections of related agents.

Any CLI tool can be transformed into a modern web interface through Ploinky's WebConsole, WebChat, and Dashboard capabilities.

Configuration is manifest-based. A simple `manifest.json` file defines each agent's container image, dependencies, and commands.

## Development Workflow

Ploinky supports seamless agent development with hot-reload capabilities and integrated debugging tools. The same containerized agents developed locally can be deployed to production with built-in health checks, ensuring consistency between development and production environments.

## Interaction Models

Agents can be interacted with in two main ways.

They can be run individually by using an agent's CLI directly through the `cli` command, passing inputs in any format the agent accepts, including JSON or natural language.

They can also be integrated with Ploinky by enabling the agent as part of the Ploinky workspace. The Ploinky server then exposes the agent on a local port, allowing applications to interact with agents through a simple API.

## Ploinky Shell

For quick interactions, Ploinky offers a dedicated shell mode for LLM command recommendations without full workspace initialization:

```bash
ploinky -shell        # interactive shell
ploinky sh            # alias
psh                   # alias
ploinky -shell <text> # single-shot suggestion
```

This mode reads API keys from `.env` files and environment variables, and allows interactive configuration of LLM models and providers through the `/settings` command.

## Why Ploinky Matters for AssistOS

Ploinky provides the secure, reproducible runtime that makes AssistOS practical. Without it, agents would need to be managed manually, with all the complexity of container orchestration, networking, and security handled by the user.

Ploinky abstracts this complexity away, letting users focus on what they want to achieve rather than how to run it.
