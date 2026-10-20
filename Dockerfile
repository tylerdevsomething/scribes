# One process: the indexer, the API, the create flow, the verification bot and the built site.
# Configure with environment variables, e.g. on Railway:
#   RPC_URL            Solana RPC for the network the scribes live on (required)
#   RPC_MAINNET        mainnet RPC for the tools' read-only market and wallet data (optional)
#   WRITER_KEY         JSON key array of the server's writer wallet (enables inscribing)
#   VERIFIER_KEY       JSON key array of the verifier (enables the verification bot)
#   FAUCET_KEY         JSON key array of the test token's mint authority (test faucet; never on mainnet)
#   ANTHROPIC_API_KEY  the free hosted brain for Claude-bound scribes, and the bot's tests (optional)
#   HIDDEN             scribe addresses the site does not show (comma separated)
#   BRAIN_PER_VISITOR / BRAIN_DAILY_USD  free messages per visitor per day (20) and the daily budget (5)
#   VITE_RPC_URL / VITE_CLUSTER  baked into the site at build time (the browser's RPC and network name)
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_RPC_URL=https://api.devnet.solana.com
ARG VITE_CLUSTER=devnet
ENV VITE_RPC_URL=$VITE_RPC_URL VITE_CLUSTER=$VITE_CLUSTER
RUN npx vite build site
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "node indexer/src/main.ts --rpc \"$RPC_URL\" --port \"$PORT\" --cache /data --site dist/site ${WRITER_KEY:+--writer env:WRITER_KEY} ${VERIFIER_KEY:+--verifier env:VERIFIER_KEY} ${FAUCET_KEY:+--faucet env:FAUCET_KEY}"]
