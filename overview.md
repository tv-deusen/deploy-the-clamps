**Infrastructure & Configuration Overview**

*Current situation, intended architecture, and service relationships*

# **Overview**

This document describes the current infrastructure environment, the software stack being deployed, and the intended relationships between all components. It covers the cloud hosting provider, DNS and network layer, AI inference services, the agent platform, its memory system, and the messaging channel through which the agent is accessed.

# **Infrastructure**

## **Cloud Hosting - Vultr**

The compute layer is hosted on Vultr. A single virtual machine instance running Ubuntu 24.04 LTS serves as the host for all application components. The instance does not use the Vultr Marketplace OpenClaw pre-built image; Ubuntu 24.04 was selected as a clean base image, with all software installed manually after provisioning.

The instance is deployed within a Vultr VPC (Virtual Private Cloud) and does have a public IP address attached. That public IP exists primarily for host administration such as SSH, not for direct publication of the OpenClaw gateway. The security model remains private-first: the gateway itself stays bound to localhost, Graphiti and its backing graph database remain private services and are never exposed on the public interface, and all user-facing access to the gateway is intended to traverse a Cloudflare Tunnel. All other external relationships in the system - including API calls to OVH, the persistent WebSocket connection to Discord, and the Cloudflare Tunnel connection - are outbound from the instance.

## **DNS - Cloudflare**

DNS is managed through Cloudflare. The domain's authoritative nameservers already point at Cloudflare; no registrar migration work is needed here beyond maintaining the correct DNS records and Zero Trust configuration in the Cloudflare zone. The earlier provider, [https://orangewebsite.com](https://orangewebsite.com), is no longer the active DNS control plane.

The intention is for a domain or subdomain managed in Cloudflare to publish the OpenClaw gateway through a named Cloudflare Tunnel, making the control interface accessible via a human-readable URL rather than requiring direct IP access. In this setup Cloudflare is more than just authoritative DNS: the tunnel provides the connectivity path and Cloudflare Access can provide the identity gate in front of the gateway. This removes the dependency on the user's residential public IP remaining stable and avoids exposing the gateway as a directly reachable origin service on the Vultr public address.

# **Software Stack**

## **OpenClaw - Agent Platform**

OpenClaw is the central application being deployed. It is an open-source autonomous AI agent platform that operates as a persistent, always-on service on the server. It is installed directly on the Ubuntu host via npm as a global package - not inside a Docker container. It runs as a systemd service so that it starts automatically on boot and is managed consistently with other system services.

OpenClaw exposes a gateway - a web server that provides a control UI and API surface for interacting with and configuring the agent. This gateway is the component intended to sit behind the Cloudflare-managed hostname. In this deployment, the gateway should listen only on localhost, with `cloudflared` on the same host forwarding traffic from Cloudflare to the local gateway port. The externally reachable surface is therefore the Cloudflare endpoint protected by Cloudflare Access, not the OpenClaw process itself.

OpenClaw uses a plugin system for extending its capabilities. The Graphiti plugin is installed to provide the agent with persistent knowledge graph memory. OpenClaw also supports multiple messaging channel integrations; in this deployment, Discord is the configured channel through which the agent is accessed and commanded.

## **Discord - Messaging Channel**

Discord is the interface through which the user interacts with the OpenClaw agent. A Discord bot application is registered in the Discord Developer Portal and its credentials are configured within OpenClaw. The bot operates by maintaining a persistent outbound WebSocket connection from the OpenClaw process to Discord's gateway servers - meaning Discord does not make any inbound connections to the Vultr instance. All message traffic flows outbound from the server.

The bot is scoped to a specific Discord server (guild) and channel, with an allowlist restricting which users are permitted to send it commands. The Message Content Intent is enabled, as OpenClaw requires the ability to read message content to function.

## **Graphiti - Knowledge Graph Memory Service**

Graphiti provides OpenClaw with persistent, temporally-aware memory in the form of a knowledge graph. Rather than storing conversation context as flat files, Graphiti builds a structured graph of entities and relationships extracted from conversations, tracking how facts evolve over time. This gives the agent a coherent, queryable view of accumulated knowledge across all sessions.

Graphiti runs as a Docker container on the same Vultr instance as OpenClaw. It exposes an HTTP API only on the private host or container network that the OpenClaw Graphiti plugin communicates with. OpenClaw itself remains installed directly on the Ubuntu host rather than in Docker; only Graphiti and its dependency, FalkorDB, are containerized.

Graphiti uses the OVH AI Endpoints service for two distinct operations: LLM inference (to extract entities and relationships from conversation text) and text embeddings (to generate vectors for knowledge graph search and retrieval). It is therefore a consumer of OVH AI Endpoints in its own right, independently of OpenClaw's own model usage.

## **FalkorDB - Graph Database**

FalkorDB is the underlying graph database in which Graphiti stores its knowledge graph. It runs as a Docker container on the same Vultr instance, alongside the Graphiti container. FalkorDB is not exposed to any external network interface; it is reachable only across the private Docker network and, if needed for maintenance, from the local host itself. Data is persisted in a named Docker volume so that the knowledge graph survives container restarts and redeployments. Replacing Neo4j with FalkorDB reduces the number of publicly relevant moving parts while keeping the graph-memory layer isolated from the internet.

# **AI Inference - OVH AI Endpoints**

OVH AI Endpoints is the provider for all AI model inference in this deployment. It serves two roles: language model inference (generating responses, making tool-use decisions, reasoning through tasks) and text embedding generation (producing vector representations of text for semantic search and memory retrieval).

OVH AI Endpoints exposes an API that is fully compatible with the OpenAI API specification. This means any component that knows how to communicate with OpenAI's API can be redirected to OVH simply by overriding the base URL and substituting an OVH API key. No custom adapters or SDKs are required.

Both OpenClaw and Graphiti are configured to use OVH AI Endpoints as their model backend. OpenClaw uses it for all agent reasoning and tool-calling decisions. Graphiti uses it for entity extraction from conversation turns (LLM calls) and for generating embedding vectors when storing and querying the knowledge graph (embedding calls). Both services share the same OVH base URL and API key, targeting different models appropriate to each task.

The models available on OVH AI Endpoints include instruction-tuned language models supporting function calling and structured output, as well as dedicated embedding models. The specific model choices for each role are part of the configuration rather than the circumstances described here.

# **Component Relationship Summary**

The following describes how the components relate to one another at runtime:

* The user sends a message to the Discord bot from within a Discord server.

* OpenClaw, running as a systemd service on the Vultr instance, receives the message over its persistent outbound WebSocket connection to Discord.

* OpenClaw constructs a prompt, optionally enriched with context retrieved from Graphiti via the private Graphiti API, and sends an inference request to OVH AI Endpoints.

* OVH AI Endpoints returns a response (potentially including tool-use instructions), which OpenClaw acts on.

* If the conversation produces new information worth retaining, the Graphiti plugin captures it: Graphiti calls OVH AI Endpoints to extract entities and generate embeddings, then writes the resulting graph data into FalkorDB.

* The OpenClaw gateway is reachable via a Cloudflare-managed hostname backed by a Cloudflare Tunnel, with Cloudflare Access enforcing who may reach it before traffic is forwarded to the local gateway listener on the Vultr host.
