FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p /app/var && chown node:node /app/var
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DB_PATH=/app/var/astrobyte.sqlite
VOLUME ["/app/var"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD ["node","-e","fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "src/server.mjs"]
