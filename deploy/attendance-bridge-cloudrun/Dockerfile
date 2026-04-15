FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.cjs ./

ENV NODE_ENV=production
ENV PORT=8080

CMD ["npm", "start"]
