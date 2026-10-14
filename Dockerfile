# One process: the indexer, the API, the create flow, the verification bot and the built site.
# Configure with environment variables, e.g. on Railway:
#   RPC_URL          Solana RPC (required)
#   WRITER_KEY       JSON key array of the server's writer wallet (enables uploads)
#   VERIFIER_KEY     JSON key array of the verifier (enables the bot); may equal the writer
#   ANTHROPIC_API_KEY  lets the bot test bound brains (optional)
#   VITE_RPC_URL / VITE_CLUSTER  baked into the site at build time
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_RPC_URL
ARG VITE_CLUSTER=devnet
RUN npx vite build site
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "node indexer/src/main.ts --rpc \"$RPC_URL\" --port \"$PORT\" --cache /data --site dist/site ${WRITER_KEY:+--writer env:WRITER_KEY} ${VERIFIER_KEY:+--verifier env:VERIFIER_KEY}"]
