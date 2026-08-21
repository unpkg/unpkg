# syntax = docker/dockerfile:1

# Use Node.js for the build image
FROM node:23.6.0-slim AS build
WORKDIR /app

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

# Install pnpm
RUN npm install -g pnpm@10.7.0

# Copy workspace configuration files
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/unpkg-files/package.json ./packages/unpkg-files/
COPY packages/unpkg-worker/package.json ./packages/unpkg-worker/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy application code
COPY packages/unpkg-files ./packages/unpkg-files/
COPY packages/unpkg-worker ./packages/unpkg-worker/

# Build all packages
RUN pnpm run build

# Create production deploy
RUN pnpm --filter unpkg-files deploy --prod dist-files


# Use Bun for the final image
FROM oven/bun:1.2.8
LABEL fly_launch_runtime="Bun"
WORKDIR /app

ENV DEBUG=1

ARG MODE=production
ENV MODE=$MODE

# Copy built application
COPY --from=build /app/dist-files /app

# Start the server
EXPOSE 3000
CMD [ "bun", "./dist/server.js" ]
