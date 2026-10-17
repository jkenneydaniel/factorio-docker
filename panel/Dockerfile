FROM docker:29.9.0-cli AS docker-cli
FROM node:24.22.0-bookworm-slim
LABEL org.opencontainers.image.title="Factory Control" org.opencontainers.image.version="0.2.4-alpha" org.opencontainers.image.licenses="MIT"
WORKDIR /app
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/
# Docker/Buildx use the OS trust store; Node's bundled roots do not cover them.
COPY --from=docker-cli /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --chown=node:node *.json *.js *.lua ./
COPY --chown=node:node LICENSE ./LICENSE
COPY --chown=node:node public ./public
USER node
ENV NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
