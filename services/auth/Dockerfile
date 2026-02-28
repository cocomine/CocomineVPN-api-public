FROM node:22.21.1-alpine3.21
LABEL authors="cocomine"
LABEL version="1.0.0"
LABEL description="CocomineAPI Auth Microservice"
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8089
ENV GRPC_PORT=50051
ENV HOST=0.0.0.0
ENV LOG_LEVEL=info
ENV TZ="Asia/Hong_Kong"
ENV REDIS_URL="redis://redis:6379"
ENV ODIC_CLIENT_SECRET=""
ENV ODIC_CLIENT_ID=""

COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable
RUN yarn install
COPY /dist ./

VOLUME ["/app/config"]
VOLUME ["/app/keys"]
VOLUME ["/app/logs"]

EXPOSE 8089
EXPOSE 50051

ENTRYPOINT ["node", "index.js"]
