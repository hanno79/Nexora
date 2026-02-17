# Docker-Build für NEXORA
# Basis-Image
FROM node:20-alpine

# Environment Variables
ENV NODE_ENV=development \
    PORT=5000

WORKDIR /app

# Kopiere package.json und installiere Dependencies
COPY package.json ./
RUN npm install

# Kopiere den Rest des Codes
COPY . .

# Expose Port
EXPOSE 5000

# Starte die App im Development-Modus
CMD ["npm", "run", "dev"]
