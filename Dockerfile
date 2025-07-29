# Backend Dockerfile
FROM node:18-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy backend files
COPY simple-backend.js .
COPY airport-city-mapping.js .

# Expose port
EXPOSE 8080

# Start the backend server
CMD ["node", "simple-backend.js"]