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


# Use Bun for the final image
FROM oven/bun:1.2.8
LABEL fly_launch_runtime="Bun"
WORKDIR /app

#ENV DEBUG=1

ARG MODE=production
ENV MODE=$MODE

# Copy built application
COPY --from=build /app/dist-www /app

# Start the server
EXPOSE 3000
CMD [ "bun", "./dist/server.js" ]
