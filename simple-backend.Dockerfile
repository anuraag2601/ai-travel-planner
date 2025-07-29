FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY simple-package.json package.json
COPY simple-backend.js server.js

# Install dependencies
RUN npm install --only=production

# Expose port
EXPOSE 8080

# No health check - Cloud Run handles this

# Start the application
CMD ["npm", "start"]