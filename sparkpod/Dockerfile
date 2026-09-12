FROM node:22-alpine

RUN addgroup -S sparkpod && adduser -S -G sparkpod sparkpod
WORKDIR /workspace
USER sparkpod

ENV NODE_ENV=development
ENV CI=true

CMD ["sh"]
