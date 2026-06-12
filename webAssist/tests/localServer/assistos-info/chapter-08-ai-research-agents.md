# Chapter 8: AI Research Agents

The ModelAutoResearcher Agent is Ploinky’s autonomous modeling laboratory. It receives a research or product objective and delivers a working, evaluated, documented model. It encapsulates the full cycle from raw data to installable artifact.

## Vision

ModelAutoResearcher Agent exists because modern modeling work is not one operation. It requires objective interpretation, data inspection, method selection, experiment planning, data preparation, training, evaluation, documentation, and knowledge extraction. In many organizations, these steps are fragmented across scripts, notebooks, manual decisions, and incomplete reports.

Ploinky treats this workflow as an agentic laboratory. The agent does not merely call a training script. It studies the objective, evaluates the workspace conditions, chooses a realistic method, runs experiments, compares results, documents limitations, and stores reusable findings as Knowledge Units.

## One Agent, Many Profiles

ModelAutoResearcher Agent is an integrated entity with multiple internal profiles. The user describes the objective: classify documents, adapt an LLM to a domain, find the best embedding model for a corpus, compare information extraction approaches, train a tabular classifier, evaluate time-series methods, or prepare a model for deployment. The agent selects the appropriate profile and handles the rest.

The agent is pragmatic. It does not assume that the most sophisticated model is always appropriate. It considers available hardware, existing data, confidentiality constraints, time, budget, and required evaluation depth. A local classical model may be better than fine-tuning an LLM when the dataset is small. A zero-shot embedding evaluation may be more appropriate than expensive adaptation when the task is exploratory. The agent chooses methods according to actual workspace constraints.

## The Full Cycle

The agent operates through seven phases.

| Phase | Responsibility |
|---|---|
| Objective interpretation | Translates the user’s goal into a concrete research plan, including task type, constraints, expected output, and success criteria. |
| Data analysis | Inspects formats, sizes, missing values, duplicates, imbalances, label quality, leakage risks, sensitivity, distributions, correlations, outliers, text lengths, languages, categories, or graph structure. |
| Experiment planning | Selects profiles, base models, training methods, validation strategy, baselines, metrics, and acceptance criteria. |
| Data preparation | Cleans, normalizes, transforms, deduplicates, splits, and documents datasets. |
| Training or experimentation | Runs fine-tuning, LoRA adaptation, classifier training, embedding evaluation, tabular modeling, time-series analysis, or comparative benchmarking. |
| Evaluation | Compares resulting models against baselines and alternatives using quantitative metrics, qualitative tests, failure cases, and user-defined criteria. |
| Delivery | Produces model artifacts, configuration, processed datasets, evaluation reports, model cards, inference instructions, limitation sheets, and Knowledge Units. |

## Synthetic Data Lab

When data is insufficient, inconsistent, or poorly balanced, the agent can activate a Synthetic Data Lab. This component generates additional examples using larger LLMs, local rules, specialized agents, or controlled augmentation procedures.

Generated examples must be traceable. Every synthetic example carries provenance, schema, generation method, version, and filtering criteria. Synthetic data is not silently mixed into training material. It remains documented so that evaluation can distinguish between real and generated data where necessary.

## Evaluation and Delivery

The agent produces more than a model file. It creates a complete delivery package containing the selected model or adaptor, configuration files, processed datasets, evaluation reports, model cards, inference instructions, known limitations, and reusable Knowledge Units.

Evaluation includes metrics, representative examples, subgroup behavior where relevant, qualitative analysis, failure cases, and comparison against baselines. The goal is not to produce a plausible model, but to produce an artifact whose quality and limits are visible.

## Knowledge Accumulation

ModelAutoResearcher Agent does not only learn by updating model weights. It builds explicit operational memory. It stores training recipes, observations about datasets, efficient configurations, recurring failures, useful benchmarks, synthetic data prompts, filtering rules, and compatibility knowledge between models and tasks.

After each experiment, the agent extracts Knowledge Units that can be validated automatically, approved by the user, or marked as experimental. These KUs are saved at workspace, folder, or subfolder level. Future experiments can search them for relevant planning context, avoid known failures, reuse validated recipes, and accelerate configuration.

## Role in the Ploinky Workspace

ModelAutoResearcher Agent is intended to become the autonomous modeling laboratory of the Ploinky workspace. It receives scientific or operational objectives, investigates solutions, prepares data, produces models, compares them rigorously, documents them, and learns procedurally from every experiment.

It is not only a tool for researchers. It is a research partner that improves with every project because it converts experimental work into structured operational knowledge.
