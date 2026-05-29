# Ploinky Node Image

This image is the shared container runtime for the default Explorer agent graph.
It starts from the current Node 24 LTS Debian slim image and preinstalls the
tools Ploinky dependency-cache preparation and Explorer's default agents need at
startup.

The Dockerfile and Docker Hub publish workflow are owned by
`AssistOS-AI/container-image-builds`:

- `AssistOS-AI/container-image-builds/images/ploinky-node/Dockerfile`
- `AssistOS-AI/container-image-builds/.github/workflows/publish-ploinky-node-image.yml`

Published image:

```text
docker.io/assistos/ploinky-node:24-bookworm-tools
```

Build locally:

```sh
podman build \
  -t docker.io/assistos/ploinky-node:24-bookworm-tools \
  ../container-image-builds/images/ploinky-node
```
