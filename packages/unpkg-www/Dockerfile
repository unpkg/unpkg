# syntax = docker/dockerfile:1

FROM node:23.6.0-slim AS base

LABEL fly_launch_runtime="Node.js"

# Node.js app lives here
WORKDIR /app

ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV


# Temp stage to reduce size of final image
FROM base AS build

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

# Install pnpm
RUN npm install -g pnpm@10.7.0

# Copy workspace configuration files
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/unpkg-app/package.json ./packages/unpkg-app/
COPY packages/unpkg-tools/package.json ./packages/unpkg-tools/
COPY packages/unpkg-www/package.json ./packages/unpkg-www/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy application code
COPY . .

# Build all packages
RUN pnpm run build

# Create production deploy
RUN pnpm --filter unpkg-www deploy --prod dist-www


# Final stage for app image
FROM base

# Copy built application
COPY --from=build /app/dist-www /app

# Start the server
EXPOSE 3000
CMD [ "node", "./dist/server.js" ]
