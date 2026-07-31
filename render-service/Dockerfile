FROM node:20-bookworm-slim

# ffmpeg + libass (sous-titres ASS) + polices de base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV PORT=8080
ENV WORK_DIR=/tmp/neoncut
EXPOSE 8080

CMD ["node", "server.js"]
