FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json core.mjs server.mjs ./
COPY --chown=node:node public ./public
RUN mkdir -p /app/.data && chown node:node /app/.data && chmod 700 /app/.data
USER node
ENV HOST=0.0.0.0 PORT=7860 TASTE_DB=/app/.data/taste.db
EXPOSE 7860
CMD ["node", "server.mjs"]
