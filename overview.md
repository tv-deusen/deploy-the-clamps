**Infrastructure & Configuration Overview**

*Current situation, intended architecture, and service relationships*

# **Overview**

This document describes the current infrastructure environment, the software stack being deployed, and the intended relationships between all components. It covers the cloud hosting provider, DNS and network layer, AI inference services, the agent platform, its memory system, and the messaging channel through which the agent is accessed.

# **Infrastructure**

## **Cloud Hosting — Vultr**

The compute layer is hosted on Vultr. A single virtual machine instance running Ubuntu 24.04 LTS serves as the host for all application components. The instance does not use the Vultr Marketplace OpenClaw pre-built image; Ubuntu 24.04 was selected as a clean base image, with all software installed manually after provisioning.

The instance is deployed within a Vultr VPC (Virtual Private Cloud). It does not have a public IP address directly attached; instead, outbound internet traffic is routed through a NAT gateway. This means the instance is not directly reachable from the public internet on any port. All outbound connections — including API calls to OVH and WebSocket connections to Discord — traverse the NAT gateway normally.

## **DNS — Cloudflare**

DNS is managed through Cloudflare. But the domain was transferred to Cloudflare from [https://orangewebsite.com](https://orangewebsite.com). 

The intention is for a domain (or subdomain) managed in Cloudflare to resolve to the OpenClaw gateway, making the control interface accessible via a human-readable URL rather than requiring direct IP access or an SSH tunnel. Cloudflare sits in front of the instance and handles DNS resolution for that domain.

The relationship between Cloudflare and the Vultr VPC requires consideration because the instance has no public IP of its own. Traffic originating from outside the VPC cannot reach the instance directly; any inbound path through Cloudflare would need to be routed appropriately given the NAT and VPC topology.

# **Software Stack**

## **OpenClaw — Agent Platform**

OpenClaw is the central application being deployed. It is an open-source autonomous AI agent platform that operates as a persistent, always-on service on the server. It is installed directly on the Ubuntu host via npm as a global package — not inside a Docker container. It runs as a systemd service so that it starts automatically on boot and is managed consistently with other system services.

OpenClaw exposes a gateway — a local web server that provides a control UI and API surface for interacting with and configuring the agent. This gateway is the component intended to be pointed at by the Cloudflare DNS entry. In its default and recommended configuration, the gateway binds to localhost only and is not directly exposed to any network interface.

OpenClaw uses a plugin system for extending its capabilities. The Graphiti plugin is installed to provide the agent with persistent knowledge graph memory. OpenClaw also supports multiple messaging channel integrations; in this deployment, Discord is the configured channel through which the agent is accessed and commanded.

## **Discord — Messaging Channel**

Discord is the interface through which the user interacts with the OpenClaw agent. A Discord bot application is registered in the Discord Developer Portal and its credentials are configured within OpenClaw. The bot operates by maintaining a persistent outbound WebSocket connection from the OpenClaw process to Discord's gateway servers — meaning Discord does not make any inbound connections to the Vultr instance. All message traffic flows outbound from the server.

The bot is scoped to a specific Discord server (guild) and channel, with an allowlist restricting which users are permitted to send it commands. The Message Content Intent is enabled, as OpenClaw requires the ability to read message content to function.

## **Graphiti — Knowledge Graph Memory**

Graphiti provides OpenClaw with persistent, temporally-aware memory in the form of a knowledge graph. Rather than storing conversation context as flat files, Graphiti builds a structured graph of entities and relationships extracted from conversations, tracking how facts evolve over time. This gives the agent a coherent, queryable view of accumulated knowledge across all sessions.

Graphiti runs as a Docker container on the same Vultr instance as OpenClaw. It exposes an HTTP API on localhost that the OpenClaw Graphiti plugin communicates with. Graphiti itself does not run on Docker by design choice for OpenClaw — only Graphiti and its dependency, Neo4j, are containerized.

Graphiti uses the OVH AI Endpoints service for two distinct operations: LLM inference (to extract entities and relationships from conversation text) and text embeddings (to generate vectors for knowledge graph search and retrieval). It is therefore a consumer of OVH AI Endpoints in its own right, independently of OpenClaw's own model usage.

## **Neo4j — Graph Database**

Neo4j is the underlying graph database in which Graphiti stores its knowledge graph. It runs as a Docker container on the same Vultr instance, alongside the Graphiti container. Neo4j is not exposed to any external network interface; it is accessible only within the Docker network and from localhost. The APOC plugin is enabled within Neo4j, as Graphiti depends on it for certain graph traversal operations. Data is persisted in a named Docker volume so that the knowledge graph survives container restarts and redeployments.

# **AI Inference — OVH AI Endpoints**

OVH AI Endpoints is the provider for all AI model inference in this deployment. It serves two roles: language model inference (generating responses, making tool-use decisions, reasoning through tasks) and text embedding generation (producing vector representations of text for semantic search and memory retrieval).

OVH AI Endpoints exposes an API that is fully compatible with the OpenAI API specification. This means any component that knows how to communicate with OpenAI's API can be redirected to OVH simply by overriding the base URL and substituting an OVH API key. No custom adapters or SDKs are required.

Both OpenClaw and Graphiti are configured to use OVH AI Endpoints as their model backend. OpenClaw uses it for all agent reasoning and tool-calling decisions. Graphiti uses it for entity extraction from conversation turns (LLM calls) and for generating embedding vectors when storing and querying the knowledge graph (embedding calls). Both services share the same OVH base URL and API key, targeting different models appropriate to each task.

The models available on OVH AI Endpoints include instruction-tuned language models supporting function calling and structured output, as well as dedicated embedding models. The specific model choices for each role are part of the configuration rather than the circumstances described here.

# **Component Relationship Summary**

The following describes how the components relate to one another at runtime:

* The user sends a message to the Discord bot from within a Discord server.

* OpenClaw, running as a systemd service on the Vultr instance, receives the message over its persistent outbound WebSocket connection to Discord.

* OpenClaw constructs a prompt, optionally enriched with context retrieved from Graphiti via the localhost Graphiti API, and sends an inference request to OVH AI Endpoints.

* OVH AI Endpoints returns a response (potentially including tool-use instructions), which OpenClaw acts on.

* If the conversation produces new information worth retaining, the Graphiti plugin captures it: Graphiti calls OVH AI Endpoints to extract entities and generate embeddings, then writes the resulting graph data into Neo4j.

* The OpenClaw gateway, bound to localhost on the Vultr instance, is intended to be reachable via a domain managed in Cloudflare DNS, providing access to the control UI.

