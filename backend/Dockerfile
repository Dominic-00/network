FROM node:20-alpine

# Install traceroute tool and curl for upstream lookups
RUN apk add --no-cache mtr curl

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3001
CMD ["node", "server.js"]
