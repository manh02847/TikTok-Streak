FROM node:22-bookworm
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
RUN npx playwright install --with-deps chromium
COPY index.js config.json ./
COPY lib ./lib
ENV HEADLESS=true
CMD ["node", "index.js"]
