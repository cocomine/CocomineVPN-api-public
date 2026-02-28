FROM node:22.21.1-alpine3.21
LABEL authors="cocomine"
LABEL version="0.9.0"
LABEL description="CocomineAPI VPN Microservice"
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV LOG_LEVEL=info
ENV SUBSCRIPTION_ID=""
ENV AZURE_CLIENT_ID=""
ENV AZURE_CLIENT_SECRET=""
ENV AZURE_TENANT_ID=""
ENV TZ="Asia/Hong_Kong"
ENV DISCORD_WEBHOOK_URL=""
ENV GMAIL_CLIENT_ID=""
ENV GMAIL_CLIENT_SECRET=""
ENV GMAIL_REFRESH_TOKEN=""
ENV ODIC_CLIENT_SECRET=""
ENV ODIC_CLIENT_ID=""
ENV SQL_DATABASE_URL=""
ENV AUTH_GRPC_URL=""

COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable
RUN yarn install
COPY /dist ./

VOLUME ["/app/config"]
VOLUME ["/app/logs"]

ENTRYPOINT ["node", "index.js"]