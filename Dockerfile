# syntax=docker/dockerfile:1
#
# One image definition for all three applications.
#
# `APP` selects which — crm, site or admin. They share a lockfile, a workspace
# and a domain package, so three near-identical Dockerfiles would be three
# places to forget the same change. Railway sets the build arg per service; see
# railway.crm.json and its siblings.
#
#   docker build --build-arg APP=crm -t forecourt-crm .
#
# The build context is the REPOSITORY ROOT, not the app directory: every app
# imports `packages/domain` through `experimental.externalDir`, and pnpm's
# store lives in the root node_modules.

ARG APP=crm

# ---------------------------------------------------------------- base
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------- deps
#
# Manifests first, source second. Docker caches this layer on the lockfile, so
# editing a page does not reinstall node_modules — which for this repo is the
# difference between a 20-second build and a three-minute one.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/crm/package.json      apps/crm/
COPY apps/site/package.json     apps/site/
COPY apps/admin/package.json    apps/admin/
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json     packages/db/
COPY packages/tokens/package.json packages/tokens/
RUN pnpm install --frozen-lockfile

# --------------------------------------------------------------- build
FROM deps AS build
ARG APP
COPY . .

# Fail here, with a sentence, rather than 90 seconds later inside pnpm.
# On Railway `APP` arrives as a service variable, and a service created without
# it would otherwise build `@forecourt/` and report "no projects matched the
# filter", which does not tell anybody what to do about it.
RUN case "$APP" in \
      crm|site|admin) echo "Building @forecourt/$APP" ;; \
      *) echo "APP must be crm, site or admin — got '$APP'." >&2; \
         echo "On Railway, set APP as a service variable; it is passed to the build." >&2; \
         exit 1 ;; \
    esac

# `apps/*/src/data/db.ts` throws at module load when DATABASE_URL is unset, and
# `next build` evaluates those modules while collecting page data. This value
# is parsed and never connected to — every page is `force-dynamic`, so nothing
# queries at build time. The real URL arrives from the environment at runtime.
ENV DATABASE_URL=postgres://build:build@127.0.0.1:5432/build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN pnpm --filter "@forecourt/${APP}" build

# ----------------------------------------------------------------- run
FROM node:20-slim AS run
ARG APP
# Promoted to ENV deliberately: a build ARG does not exist in the running
# container, so CMD would expand `${APP}` to an empty string and the server
# would be looked for at `apps//server.js`.
ENV APP=${APP}
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next's standalone server binds 127.0.0.1 by default, which inside a container
# means nothing outside it can connect and the platform's health check fails
# with no log line explaining why.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app

# Not root. The server needs to read its own files and nothing else.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# The three pieces standalone output comes in: the traced server and its
# node_modules, the client chunks, and the public assets.
COPY --from=build --chown=nextjs:nodejs /repo/apps/${APP}/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static

# A fixed entrypoint path, with the app name BAKED IN at build time.
#
# Standalone preserves the workspace layout, so the server lives at
# `apps/<app>/server.js` rather than at the root — which means the obvious
# `CMD node apps/$APP/server.js` depends on something expanding `$APP`. A
# platform that runs the start command through a shell expands it; one that
# execs it directly does not, and the failure is an unreadable "cannot find
# module apps//server.js".
#
# Writing the name in here removes the question. `/app/start.sh` takes no
# arguments, needs no variables and is the same string for every service, so
# it can be pasted into any platform's start-command box without thinking
# about how that box is evaluated.
RUN printf '#!/bin/sh\nexec node /app/apps/%s/server.js\n' "$APP" > /app/start.sh \
 && chmod +x /app/start.sh \
 && chown nextjs:nodejs /app/start.sh

USER nextjs
EXPOSE 3000

CMD ["/app/start.sh"]
